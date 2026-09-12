// 同一个 file_uuid 在一次导出里会重复出现：同一条 message 的 files 和 files_v2、
// 或者被多条 message 引用。两个 occurrence 都要各自进 manifest（不合并），
// 但它们讲的必须是同一件事——第一个确认了 original，第二个不该退回 null。
const { build, memoryDirectory, JPEG, WEBP } = require('./harness.cjs')

const METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting',
    'inheritRecordedProvenance', 'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]
const NAME = 'shot_[X].png'
const FILE = { file_uuid: 'X', file_name: 'shot.png', file_kind: 'image', preview_url: '/api/o/files/X/preview' }

function service() {
    const fetched = []
    return { fetched, svc: build(METHODS, {
        t: (...a) => String(a[0]),
        Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI: {
            buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
            getOrganizationInfo: async () => ({ uuid: 'o' }),
            async downloadFile(url) {
                fetched.push(url)
                if (url.includes('/contents')) return JPEG()
                if (url.includes('/preview')) return WEBP()
                const e = new Error('404'); e.status = 404; throw e
            }
        },
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    }) }
}
const sha = async blob => {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function seeded() {
    const dir = memoryDirectory({ [NAME]: WEBP() })
    dir.files.set('attachments-manifest.json', new Blob([JSON.stringify({
        assets: [{ localFile: NAME, key: 'X', fileId: 'X', sha256: await sha(dir.files.get(NAME)), variant: 'preview' }]
    })]))
    return dir
}

module.exports = async function () {
    // 同一条 message 的 files 与 files_v2 指向同一个 file_uuid
    {
        const dir = await seeded()
        const { svc, fetched } = service()
        const history = { uuid: 'c', chat_messages: [{
            uuid: 'm1', sender: 'human', attachments: [], files: [{ ...FILE }], files_v2: [{ ...FILE }]
        }] }
        const m = await svc.exportAttachmentsForConversation(history, dir, () => {})
        check('两个 occurrence 都各自入账，没被合并', m.assets.length === 2, String(m.assets.length))
        const [one, two] = m.assets
        check('第一个下到了 original', one.status === 'downloaded' && one.variant === 'original', `${one.status}/${one.variant}`)
        check('第二个看到同样的 bytes，继承 original', two.variant === 'original', `${two.status}/${two.variant}`)
        check('第二个不再重下', two.status === 'existing', two.status)
        check('两者 sha 相同', one.sha256 === two.sha256)
        check('/contents 只真正成功下了一次', fetched.filter(u => u.includes('/contents')).length === 1,
            String(fetched.filter(u => u.includes('/contents')).length))
        check('引用各自保留', one.references.length === 1 && two.references.length === 1)
    }

    // 同一个 file_uuid 被两条不同 message 引用
    {
        const dir = await seeded()
        const { svc } = service()
        const history = { uuid: 'c', chat_messages: [
            { uuid: 'm1', sender: 'human', attachments: [], files_v2: [], files: [{ ...FILE }] },
            { uuid: 'm2', sender: 'human', attachments: [], files_v2: [], files: [{ ...FILE }] }
        ] }
        const m = await svc.exportAttachmentsForConversation(history, dir, () => {})
        check('跨 message 的重复引用也各自入账', m.assets.length === 2, String(m.assets.length))
        check('两条 variant 一致为 original', m.assets.every(a => a.variant === 'original'),
            m.assets.map(a => `${a.status}/${a.variant}`).join(' '))
        check('两条指向不同 message', m.assets[0]?.references[0]?.messageUuid !== m.assets[1]?.references[0]?.messageUuid)
    }
}
