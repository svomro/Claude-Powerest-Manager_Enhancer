// 附件身份是 fileId/key/localFile，不是 sha256。
//
// 同一份 bytes 可以被多个引用共享——真实导出里有一处 20 个不同 fileId 共用同一个
// sha256（那批 file_name 为空、走 unknown_file 兜底的 extracted-text）。拿 hash 当
// 上一轮记录的唯一 key，后面的记录就会把前面的覆盖掉，provenance 互相串。
const { build, memoryDirectory, JPEG, WEBP } = require('./harness.cjs')

const METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting',
    'inheritRecordedProvenance', 'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]
const NAME_A = 'a_[file-A].png'
const NAME_B = 'b_[file-B].png'

const history = () => ({
    uuid: 'conv-1',
    chat_messages: [{
        uuid: 'msg-1', sender: 'human', attachments: [], files_v2: [],
        files: [
            { file_uuid: 'file-A', file_name: 'a.png', file_kind: 'image', preview_url: '/api/o/files/file-A/preview' },
            { file_uuid: 'file-B', file_name: 'b.png', file_kind: 'image', preview_url: '/api/o/files/file-B/preview' }
        ]
    }]
})

function service() {
    const fetched = []
    return { fetched, svc: build(METHODS, {
        t: (...a) => String(a[0]),
        Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI: {
            buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
            getOrganizationInfo: async () => ({ uuid: 'o' }),
            async downloadFile(url) { fetched.push(url); if (url.includes('/preview')) return WEBP(); const e = new Error('404'); e.status = 404; throw e }
        },
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    }) }
}
const sha = async blob => {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

module.exports = async function () {
    // A 和 B 字节完全相同，但上一轮记的 variant 不同；B 在 manifest 里排在 A 后面
    const bytes = JPEG()
    const dir = memoryDirectory({ [NAME_A]: bytes.slice(), [NAME_B]: bytes.slice() })
    const hash = await sha(bytes)
    dir.files.set('attachments-manifest.json', new Blob([JSON.stringify({
        assets: [
            { localFile: NAME_A, key: 'file-A', fileId: 'file-A', sha256: hash, variant: 'original' },
            { localFile: NAME_B, key: 'file-B', fileId: 'file-B', sha256: hash, variant: 'preview' }
        ]
    })]))

    const { svc } = service()
    const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
    const a = m.assets.find(x => x.fileId === 'file-A')
    const b = m.assets.find(x => x.fileId === 'file-B')

    check('A 继承到自己的 original，没被 B 污染', a.variant === 'original', String(a.variant))
    check('B 仍然是自己的记录', b.variant === 'preview', `${b.status}/${b.variant}`)
    check('A 的 bytes 没被动', dir.files.get(NAME_A).size === bytes.size)

    // 身份对得上但 bytes 变了 → 不许继承（旧记录已经不描述现在这份文件）
    {
        const d2 = memoryDirectory({ [NAME_A]: WEBP() })
        d2.files.set('attachments-manifest.json', new Blob([JSON.stringify({
            assets: [{ localFile: NAME_A, key: 'file-A', fileId: 'file-A', sha256: 'deadbeef', variant: 'original' }]
        })]))
        const { svc: s2 } = service()
        const one = () => ({ uuid: 'c', chat_messages: [{ uuid: 'm', sender: 'human', attachments: [], files_v2: [],
            files: [{ file_uuid: 'file-A', file_name: 'a.png', file_kind: 'image', preview_url: '/api/o/files/file-A/preview' }] }] })
        const r = (await s2.exportAttachmentsForConversation(one(), d2, () => {})).assets[0]
        check('sha 对不上时不继承陈旧的 variant', r.variant !== 'original', String(r.variant))
    }
}
