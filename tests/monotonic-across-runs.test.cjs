// monotonic 必须跨多次重跑成立，不只是单次。
//
// 反例：已有文件被接受为 existing 时，如果不把上一份 manifest 的 variant 继承下来，
// 新 manifest 就会把「已知是 original」重新写成 null。下一次运行读到 null，
// 启发式重新把它猜成 preview，回源失败后就可能用 preview 覆盖它。
const { build, memoryDirectory, JPEG, WEBP } = require('./harness.cjs')

const METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting', 'inheritRecordedProvenance',
    'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]
const NAME = 'renamed_[u-1].png'
const history = () => ({
    uuid: 'conv-1',
    chat_messages: [{
        uuid: 'msg-1', sender: 'human', attachments: [], files_v2: [],
        files: [{ file_uuid: 'u-1', file_name: 'renamed.png', file_kind: 'image', preview_url: '/api/org-1/files/u-1/preview' }]
    }]
})

function service(dir) {
    const fetched = []
    const ClaudeAPI = {
        buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
        getOrganizationInfo: async () => ({ uuid: 'org-1' }),
        async downloadFile(url) {
            fetched.push(url)
            if (url.includes('/preview')) return WEBP()           // preview 永远活着
            const e = new Error('404'); e.status = 404; throw e   // source 已死
        }
    }
    const svc = build(METHODS, {
        t: (...a) => String(a[0]),
        Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI, EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    })
    return { svc, fetched }
}

const sha = async blob => {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

module.exports = async function () {
    // 已有文件是 WebP、名字是 .png，但上一份 manifest 已经证明它就是 original
    const dir = memoryDirectory({ [NAME]: WEBP() })
    const startBytes = dir.files.get(NAME).size
    dir.files.set('attachments-manifest.json', new Blob([JSON.stringify({
        assets: [{ localFile: NAME, sha256: await sha(dir.files.get(NAME)), variant: 'original' }]
    })]))

    const first = service(dir)
    const m1 = (await first.svc.exportAttachmentsForConversation(history(), dir, () => {})).assets[0]
    check('run1 保留了已有文件', m1.status === 'existing', m1.status)
    check('run1 没发请求', first.fetched.length === 0, String(first.fetched.length))
    check('run1 继承了已知的 variant（不能退回 null）', m1.variant === 'original', String(m1.variant))

    // run2 读的是 run1 写出的 manifest
    const second = service(dir)
    const m2 = (await second.svc.exportAttachmentsForConversation(history(), dir, () => {})).assets[0]
    check('run2 仍然保留', m2.status === 'existing', `${m2.status}/${m2.variant}`)
    check('run2 字节没变', dir.files.get(NAME).size === startBytes, `${dir.files.get(NAME).size} vs ${startBytes}`)
    check('run2 也没被 preview 覆盖', m2.variant !== 'preview', String(m2.variant))

    // 反向：source 活着时，original 必须能升级掉旧 WebP
    {
        const up = memoryDirectory({ [NAME]: WEBP() })
        const fetched = []
        const svc = build(METHODS, {
            t: (...a) => String(a[0]),
            Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
            LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
            ClaudeAPI: {
                buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
                getOrganizationInfo: async () => ({ uuid: 'org-1' }),
                async downloadFile(url) { fetched.push(url); if (url.includes('/contents')) return JPEG(); if (url.includes('/preview')) return WEBP(); const e = new Error('404'); e.status = 404; throw e }
            },
            EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
        })
        const m = (await svc.exportAttachmentsForConversation(history(), up, () => {})).assets[0]
        check('source 活着时旧 WebP 被 original 升级掉', m.status === 'downloaded' && m.variant === 'original', `${m.status}/${m.variant}`)
    }
}
