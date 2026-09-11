// 重跑必须单调安全：已经保存好的原图，永远不许被 preview 换掉。
//
// 反例来自真实导出（2026-09-12）：`019db9f4…` 和 `66b1564b…` 是 `.png` 文件名配
// 真 JPEG 字节，manifest 记的是 variant: original——Claude 的 /contents 就是这么给的。
// 旧规则「扩展名 ≠ 真实类型就判不可用」会把它们重下，一旦 source blob 已过期，
// 就会用 WebP preview 覆盖掉真原图。
const { build, memoryDirectory, JPEG, WEBP } = require('./harness.cjs')

const METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting', 'inheritRecordedProvenance',
    'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]

function makeService({ contents, preview }) {
    const fetched = []
    const ClaudeAPI = {
        buildConversationTree: messages => ({ nodes: Object.fromEntries(messages.map(m => [m.uuid, m])) }),
        getOrganizationInfo: async () => ({ uuid: 'org-1', name: 'Org' }),
        async downloadFile(url) {
            fetched.push(url)
            // 按候选精确路由。legacy 的 document_<ext> 端点在 2026-09-11 实测里
            // 对新旧文件都 404，桩必须照实反映，否则它会伪装成"原图成功"。
            let handler
            if (url.includes('/contents')) handler = contents
            else if (url.includes('/preview')) handler = preview
            else { const e = new Error('404'); e.status = 404; throw e }
            const calls = fetched.filter(u => u.includes(url.includes('/contents') ? '/contents' : '/preview')).length
            const result = typeof handler === 'function' ? handler(calls) : handler
            if (result instanceof Error) throw result
            return result
        }
    }
    const svc = build(METHODS, {
        t: (...a) => String(a[0]),
        Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI, EXPORTER_NAME: 'claude-powerest-manager-enhancer', SCRIPT_VERSION: 'test',
        console: { warn: () => {}, error: () => {} }
    })
    return { svc, fetched }
}

const history = () => ({
    uuid: 'conv-1',
    chat_messages: [{
        uuid: 'msg-1', sender: 'human', attachments: [], files_v2: [],
        files: [{ file_uuid: 'u-1', file_name: 'shot.png', file_kind: 'image', preview_url: '/api/org-1/files/u-1/preview' }]
    }]
})
const NAME = 'shot_[u-1].png'

module.exports = async function () {
    // 1. 真实反例：.png 名字 + JPEG 字节，且上一份 manifest 说它是 original
    {
        const dir = memoryDirectory({ [NAME]: JPEG() })
        const { svc, fetched } = makeService({ contents: () => { const e = new Error('404'); e.status = 404; throw e }, preview: WEBP() })
        const hash = await (async () => {
            const digest = await crypto.subtle.digest('SHA-256', await dir.files.get(NAME).arrayBuffer())
            return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
        })()
        dir.files.set('attachments-manifest.json', new Blob([JSON.stringify({
            assets: [{ localFile: NAME, sha256: hash, variant: 'original' }]
        })]))
        const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
        const a = m.assets[0]
        check('旧 manifest 说是 original → 保留，不重下', a.status === 'existing', a.status)
        check('一次网络请求都不发', fetched.length === 0, fetched.join(','))
        check('JPEG 字节原样留在盘上', dir.files.get(NAME).size === JPEG().size)
        check('名实不符只记录，不当缺陷', a.mediaTypeMismatch !== null, String(a.mediaTypeMismatch))
    }

    // 2. 没有旧 manifest 的遗留 JPEG-under-.png：连下载都不该发起
    {
        const dir = memoryDirectory({ [NAME]: JPEG() })
        const { svc, fetched } = makeService({ contents: () => { const e = new Error('404'); e.status = 404; throw e }, preview: WEBP() })
        const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
        const a = m.assets[0]
        check('无旧 manifest 的 JPEG-under-.png 也保留', a.status === 'existing', a.status)
        check('不发任何请求（名实不符不再是重下的理由）', fetched.length === 0, fetched.join(','))
        check('盘上仍是 JPEG，没被 WebP 覆盖', dir.files.get(NAME).size === JPEG().size, String(dir.files.get(NAME).size))
    }

    // 2b. 护栏本身：manifest 说这是 preview，但本地字节是 JPEG，回源又只有 preview。
    // 第一道判断会放行去下载，此时必须由覆盖护栏挡住。
    {
        const dir = memoryDirectory({ [NAME]: JPEG() })
        const { svc, fetched } = makeService({ contents: () => { const e = new Error('404'); e.status = 404; throw e }, preview: WEBP() })
        const digest = await crypto.subtle.digest('SHA-256', await dir.files.get(NAME).arrayBuffer())
        const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
        dir.files.set('attachments-manifest.json', new Blob([JSON.stringify({
            assets: [{ localFile: NAME, sha256: hash, variant: 'preview' }]
        })]))
        const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
        const a = m.assets[0]
        check('护栏挡住了 preview 覆盖', a.status === 'existing', a.status)
        check('确实尝试过回源（护栏是第二道，不是第一道）', fetched.length > 0, String(fetched.length))
        check('盘上仍是 JPEG', dir.files.get(NAME).size === JPEG().size, String(dir.files.get(NAME).size))
        check('manifest 说明了为什么没换', /kept the existing/.test(String(a.originalError)), String(a.originalError))
    }

    // 3. 本地是 WebP preview（旧 bug 的产物）→ 应该回源升级
    {
        const dir = memoryDirectory({ [NAME]: WEBP() })
        const { svc, fetched } = makeService({ contents: JPEG(), preview: WEBP() })
        const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
        const a = m.assets[0]
        check('WebP 冒充 .png → 回源取原图', a.status === 'downloaded' && a.variant === 'original', `${a.status}/${a.variant}`)
        check('确实打了 /contents', fetched.some(u => u.includes('/contents')))
        check('盘上换成了 JPEG', a.detectedMediaType === 'image/jpeg', String(a.detectedMediaType))
    }

    // 4. WebP 本地副本、回源也只有 preview → 允许覆盖（同级，不算降级）
    {
        const dir = memoryDirectory({ [NAME]: WEBP() })
        const { svc } = makeService({ contents: () => { const e = new Error('404'); e.status = 404; throw e }, preview: WEBP() })
        const m = await svc.exportAttachmentsForConversation(history(), dir, () => {})
        check('preview 覆盖 preview 是允许的', ['downloaded', 'existing'].includes(m.assets[0].status), m.assets[0].status)
    }
}
