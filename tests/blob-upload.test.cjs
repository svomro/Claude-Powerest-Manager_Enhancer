// 沙盒上传（file_kind: blob）不在 /files/{uuid} 命名空间里。
//
// 反例来自真实导出（2026-09-12，357 个会话）：会话 fcd39a3e 里一份 66633 字节的
// JSON 被记成 unavailable，而它当时正好端端挂在网页上能预览。/files/{uuid}/contents
// 对它是必然的 404——它按 path 存在会话自己的 wiggle 空间里，而 history 的 files[]
// 里就带着那个 path。导出器一直握着所需的一切，只是从没构造过这条候选。
const { build, memoryDirectory } = require('./harness.cjs')

const METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting',
    'inheritRecordedProvenance', 'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]
const ORG = '34c4db81'
const CONV = 'fcd39a3e'
const BODY = JSON.stringify({ uuid: 'fcf83b37', name: '修改prompt' })
const SIZE = new TextEncoder().encode(BODY).length

const blobFile = o => ({
    success: true, path: '/mnt/user-data/uploads/history-2026-06-10T14-44-53_副本.json',
    file_kind: 'blob', file_uuid: 'e60ce0d6', uuid: 'e60ce0d6',
    file_name: 'history-2026-06-10T14-44-53_副本.json', size_bytes: SIZE, ...o
})
const history = files => ({ uuid: CONV, chat_messages: [{ uuid: 'm1', sender: 'human', attachments: [], files_v2: [], files }] })

function service(download) {
    const asked = []
    return { asked, svc: build(METHODS, {
        t: (...a) => String(a[0]), Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI: {
            buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
            getOrganizationInfo: async () => ({ uuid: ORG }),
            async downloadFile(url) { asked.push(url); return download(url) }
        },
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    }) }
}
const gone = () => { const e = new Error('404'); e.status = 404; throw e }

module.exports = async () => {
    const { svc } = service(gone)

    // —— 候选 URL 本身 ——
    const wiggleOf = (file, org = ORG, conv = CONV) =>
        svc.conversationFileUrls(file, org, conv).find(c => c.url.includes('wiggle')) || null
    const blob = wiggleOf(blobFile())
    check('blob 产出 wiggle 候选', blob != null, JSON.stringify(blob))
    check('走的是 conversations 而不是 files 命名空间',
        blob?.url.includes(`/conversations/${CONV}/`) && !blob?.url.includes('/files/'), blob?.url)
    check('path 作为 query 参数且已编码',
        blob?.url.includes('path=%2Fmnt%2Fuser-data%2Fuploads%2F'), blob?.url)
    check('中文文件名被编码，不会裸奔进 URL', !/副本/.test(blob?.url || ''), blob?.url)
    check('blob 拿到的是原件，不是降级件', blob?.variant === 'original')

    check('非 blob 不产出 wiggle 候选', wiggleOf({ file_kind: 'image', path: '/x', file_uuid: 'i1' }) === null)
    check('没有 path 的 blob 不产出候选', wiggleOf(blobFile({ path: undefined })) === null)
    check('缺会话 id 时不瞎构造', wiggleOf(blobFile(), ORG, null) === null)
    check('缺 org 时不瞎构造', wiggleOf(blobFile(), null, CONV) === null)

    // —— 候选顺序：先问对地方 ——
    const list = svc.conversationFileUrls(blobFile(), ORG, CONV)
    check('wiggle 排在 /contents 之前',
        list.findIndex(c => c.url.includes('wiggle')) < list.findIndex(c => c.url.includes('/contents')),
        JSON.stringify(list.map(c => c.url)))
    check('blob 不会去凑 document_ext 那条候选（旧代码已排除，别回退）',
        !list.some(c => /document_/.test(c.url)), JSON.stringify(list.map(c => c.url)))
    check('普通图片的候选里没有 wiggle',
        !svc.conversationFileUrls({ file_kind: 'image', file_uuid: 'i1', file_name: 'a.png', preview_url: '/p' }, ORG, CONV)
            .some(c => c.url.includes('wiggle')))

    // —— 端到端：/contents 404，wiggle 有 ——
    {
        const s = service(url => {
            if (url.includes('wiggle')) return new Blob([BODY])
            return gone()
        })
        const dir = memoryDirectory()
        const m = await s.svc.exportAttachmentsForConversation(history([blobFile()]), dir, () => {})
        const a = m.assets[0]
        check('不再记成 unavailable', a?.status === 'downloaded', JSON.stringify({ status: a?.status, error: a?.error }))
        check('variant 是 original', a?.variant === 'original', String(a?.variant))
        check('manifest 汇总跟着对', m.unavailable === 0 && m.downloaded === 1 && m.complete === true,
            JSON.stringify({ u: m.unavailable, d: m.downloaded, c: m.complete }))
        check('文件真的落了盘', dir.files.has(a?.localFile), [...dir.files.keys()].join(','))
        check('确实问过 wiggle', s.asked.some(u => u.includes('wiggle')), s.asked.join(' | '))
    }

    // —— size_bytes 参与校验 ——
    {
        const s = service(url => url.includes('wiggle') ? new Blob(['截断了']) : gone())
        const dir = memoryDirectory()
        const m = await s.svc.exportAttachmentsForConversation(history([blobFile()]), dir, () => {})
        check('size_bytes 对不上时不当成功（blob 的大小字段不叫 file_size）',
            m.assets[0]?.status !== 'downloaded', JSON.stringify({ status: m.assets[0]?.status, err: m.assets[0]?.error }))
    }

    // —— 真没了的时候仍如实记 ——
    {
        const s = service(gone)
        const dir = memoryDirectory()
        const m = await s.svc.exportAttachmentsForConversation(history([blobFile()]), dir, () => {})
        check('wiggle 也 404 时仍记 unavailable，不谎报成功', m.assets[0]?.status === 'unavailable',
            JSON.stringify({ status: m.assets[0]?.status }))
    }
}
