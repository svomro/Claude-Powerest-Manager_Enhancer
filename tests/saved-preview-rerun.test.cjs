// 一张已经存下来的 preview，重跑既不该白白重下，更不该被记成没了。
//
// 反例来自真实导出（2026-10-10，028f047f）：十七张图的原件在服务器上已经 404，
// 存下来的是 preview。preview 是重新编码的，大小永远对不上 history 里登记的
// file_size，于是每一轮重跑都把它判成坏文件：先白打两次 404，再把 preview 下一遍、
// 重写一遍。盘上那十七个文件的修改时间全是当天，十四张原件还停在九月。眼下结果
// 一样；可哪天 preview 地址也不应了，这一条就会被记成 unavailable、sha256 清空，
// 文件明明还在盘上。
//
// 之前的重跑测试都没给 file_size，size 校验一次也没触发过，所以一直没撞上。
const { build, memoryDirectory, JPEG, WEBP } = require('./harness.cjs')

const CONVERSATION_METHODS = [
    'conversationFileUrls', 'fetchAttachmentBlob', 'recordAttachmentBytes',
    'inspectExistingAttachment', 'existingCopyIsDowngraded', 'mayReplaceExisting', 'inheritRecordedProvenance',
    'readPreviousManifest', 'collectConversationAttachments',
    'exportAttachmentsForConversation', 'writeFileToDirectory'
]
const CODE_METHODS = [
    'exportCodeSessionAttachments', 'collectCodeSessionAttachments', 'parseInlineImage',
    'getImageExtension', 'buildCodeAttachmentFileName', 'sanitizeFileNamePart', 'inlineImageToBlob',
    'fileExists', 'writeFileToDirectory', 'inspectExistingAttachment', 'fetchAttachmentBlob',
    'recordAttachmentBytes', 'existingCopyIsDowngraded', 'mayReplaceExisting',
    'inheritRecordedProvenance', 'readPreviousManifest'
]
const MANIFEST = 'attachments-manifest.json'

const status = code => { const e = new Error(String(code)); e.status = code; return e }
const answer = route => { const value = typeof route === 'function' ? route() : route; if (value instanceof Error) throw value; return value }

// 按候选精确路由：/contents 和 legacy 的 document_<ext> 是原件，/preview 是缩略图。
// 默认就是那个会话的现状：原件两条路都 404，preview 还活着。
function service(methods, { contents = () => status(404), preview = () => WEBP() } = {}) {
    const fetched = []
    const svc = build(methods, {
        t: (...a) => String(a[0]),
        Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        atob: x => Buffer.from(x, 'base64').toString('binary'),
        ClaudeAPI: {
            buildConversationTree: m => ({ nodes: Object.fromEntries(m.map(x => [x.uuid, x])) }),
            getOrganizationInfo: async () => ({ uuid: 'org-1' }),
            async downloadFile(url) {
                fetched.push(url)
                if (url.includes('/contents')) return answer(contents)
                if (url.includes('/preview')) return answer(preview)
                throw status(404)
            }
        },
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    })
    return { svc, fetched }
}

// 真实那条的形状：原件登记 394181 字节，存下来的 preview 只有它的零头
const DECLARED = 394181
const NAME = 'Zeta_20260201183647_[7bc81e4e].jpeg'
const history = (extra = {}) => ({
    uuid: 'conv-1',
    chat_messages: [{
        uuid: 'msg-1', sender: 'human', attachments: [], files_v2: [],
        files: [{ file_uuid: '7bc81e4e', file_name: 'Zeta_20260201183647.jpeg', file_kind: 'image',
            file_size: DECLARED, preview_url: '/api/org-1/files/7bc81e4e/preview', ...extra }]
    }]
})
async function run(dir, routes, h = history()) {
    const { svc, fetched } = service(CONVERSATION_METHODS, routes)
    const manifest = await svc.exportAttachmentsForConversation(h, dir, () => {})
    return { a: manifest.assets[0], fetched }
}

const sha = async blob => {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const manifestOf = (...assets) => new Blob([JSON.stringify({ assets })])
const jpegOfSize = n => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); b.fill(0x41, 4); return new Blob([b]) }
const KEPT = /kept the existing local copy because no candidate could be fetched/

module.exports = async function () {
    // —— 一、真实那条：preview 存下来以后的每一轮 ——
    {
        const dir = memoryDirectory()
        const first = await run(dir, {})
        check('第一轮：原件 404，存下 preview', first.a.status === 'downloaded' && first.a.variant === 'preview',
            `${first.a.status}/${first.a.variant}`)
        const saved = dir.files.get(NAME)
        const savedSha = first.a.sha256

        const second = await run(dir, {})
        check('第二轮：认得出是自己存的 preview，记 existing', second.a.status === 'existing' && second.a.variant === 'preview',
            `${second.a.status}/${second.a.variant}`)
        check('第二轮：没有重写那个文件', dir.files.get(NAME) === saved)
        check('第二轮：仍然试过换成原件', second.fetched.some(u => u.includes('/contents')), second.fetched.join(','))
        check('第二轮：原件为什么没用上照样写着', /404/.test(String(second.a.originalError)), String(second.a.originalError))

        // preview 地址也不应了。旧代码在这一轮把它记成 unavailable、清空 sha256。
        const third = await run(dir, { preview: () => status(404) })
        check('preview 也 404：盘上那份仍记 existing / preview', third.a.status === 'existing' && third.a.variant === 'preview',
            `${third.a.status}/${third.a.variant}`)
        check('preview 也 404：sha256 还是那份字节的', third.a.sha256 === savedSha, String(third.a.sha256))
        check('preview 也 404：error 留空，这个附件有字节', third.a.error === null, String(third.a.error))
        check('preview 也 404：三个候选各自的失败都记下了', (String(third.a.originalError).match(/: 404/g) || []).length === 3,
            String(third.a.originalError))
        check('preview 也 404：写明了为什么留着旧的', KEPT.test(String(third.a.originalError)), String(third.a.originalError))
        check('preview 也 404：文件还是原来那个', dir.files.get(NAME) === saved)

        // 不是没了，只是这一趟取不到，比如登录态过期。旧代码记 failed，日志报 ERROR。
        const fourth = await run(dir, { preview: () => status(401) })
        check('401 也不连累盘上那份', fourth.a.status === 'existing' && fourth.a.variant === 'preview',
            `${fourth.a.status}/${fourth.a.variant}`)

        // 留下来的这条记录，下一轮还得认得出
        const fifth = await run(dir, {})
        check('之后照常认得出', fifth.a.status === 'existing' && fifth.a.variant === 'preview' && fifth.a.sha256 === savedSha,
            `${fifth.a.status}/${fifth.a.variant}`)

        // 原件哪天回来了。认出它是 preview，本来就是为了还能把它换掉。
        const sixth = await run(dir, { contents: () => jpegOfSize(DECLARED) })
        check('原件回来时照样升级',
            sixth.a.status === 'downloaded' && sixth.a.variant === 'original' && dir.files.get(NAME).size === DECLARED,
            `${sixth.a.status}/${sixth.a.variant}/${dir.files.get(NAME).size}`)
    }

    // —— 二、长度的口子只开给自己存的 preview，别的长度不对照旧当坏文件 ——
    {
        // 截断的原件：头是合法 JPEG，长度不对，没有任何记录
        const dir = memoryDirectory({ [NAME]: JPEG() })
        const { a } = await run(dir, { contents: () => jpegOfSize(DECLARED) })
        check('截断的原件仍被判坏，换成完整原件',
            a.status === 'downloaded' && a.variant === 'original' && dir.files.get(NAME).size === DECLARED,
            `${a.status}/${a.variant}/${dir.files.get(NAME).size}`)
    }
    {
        // 记过 preview，可盘上的字节已经不是那一份
        const dir = memoryDirectory({ [NAME]: WEBP() })
        dir.files.set(MANIFEST, manifestOf({ fileId: '7bc81e4e', localFile: NAME, sha256: 'f'.repeat(64), variant: 'preview' }))
        const { a } = await run(dir, { contents: () => jpegOfSize(DECLARED) })
        check('记录对不上字节，就不算自己存的 preview', a.status === 'downloaded' && a.variant === 'original', `${a.status}/${a.variant}`)
    }
    {
        // 记录说是 original、字节也对得上，可长度不符：只有重新编码的 preview 才天然不等长
        const dir = memoryDirectory({ [NAME]: JPEG() })
        dir.files.set(MANIFEST, manifestOf({ fileId: '7bc81e4e', localFile: NAME, sha256: await sha(dir.files.get(NAME)), variant: 'original' }))
        const { a } = await run(dir, { contents: () => jpegOfSize(DECLARED) })
        check('长度不符的 original 记录不享受豁免',
            a.status === 'downloaded' && a.variant === 'original' && dir.files.get(NAME).size === DECLARED, `${a.status}/${a.variant}`)
    }

    // —— 三、和长度无关：usable 的已有文件，回源全部失败也不该被记成没了 ——
    {
        const dir = memoryDirectory({ [NAME]: WEBP() })
        const savedSha = await sha(dir.files.get(NAME))
        dir.files.set(MANIFEST, manifestOf({ fileId: '7bc81e4e', localFile: NAME, sha256: savedSha, variant: 'preview' }))
        const { a, fetched } = await run(dir, { preview: () => status(404) }, history({ file_size: undefined }))
        check('没有登记大小时同样留住已有的', a.status === 'existing' && a.variant === 'preview' && a.sha256 === savedSha,
            `${a.status}/${a.variant}`)
        check('确实三个候选都问过', fetched.length === 3, String(fetched.length))
    }
    {
        // 旧版本留下的 WebP，没有 manifest：它是不是 preview 只是猜的。留着、记下字节，
        // 来路说不清就记 null，交给日志报 variant-null，和护栏那条分支一个说法。
        const dir = memoryDirectory({ [NAME]: WEBP() })
        const { a } = await run(dir, { preview: () => status(404) }, history({ file_size: undefined }))
        check('无记录的旧 WebP：留着、记字节、来路记 null',
            a.status === 'existing' && a.variant === null && typeof a.sha256 === 'string', `${a.status}/${a.variant}/${a.sha256}`)
    }
    {
        const dir = memoryDirectory()
        const { a } = await run(dir, { preview: () => status(404) })
        check('盘上什么都没有时照旧记 unavailable', a.status === 'unavailable' && a.sha256 === null, `${a.status}/${a.sha256}`)
    }

    // —— 四、Claude Code 会话：没有内联图可退时，同一条规则 ——
    const NAME_CODE = 'shot_[u-dead].png'
    const exportData = () => ({ session: { uuid: 's' }, events: [{ payload: {
        file_attachments: [{ file_uuid: 'u-dead', file_name: 'shot.png', is_image: true, preview_url: '/api/org-1/files/u-dead/preview' }]
    } }] })
    {
        const dir = memoryDirectory({ [NAME_CODE]: WEBP() })
        const savedSha = await sha(dir.files.get(NAME_CODE))
        dir.files.set(MANIFEST, manifestOf({ fileId: 'u-dead', key: 'u-dead', localFile: NAME_CODE, sha256: savedSha, variant: 'preview' }))
        const { svc, fetched } = service(CODE_METHODS, { preview: () => status(404) })
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org-1', () => {}, 's')
        const a = result.manifest.assets[0]
        check('Claude Code：回源失败又没有内联图，盘上那份仍记 existing / preview',
            a.status === 'existing' && a.variant === 'preview' && a.sha256 === savedSha, `${a.status}/${a.variant}`)
        check('Claude Code：计进 skipped，不计 failed', result.skipped === 1 && result.failed === 0, JSON.stringify(result))
        check('Claude Code：确实回过源', fetched.length > 0, String(fetched.length))
        check('Claude Code：写明了为什么留着旧的', KEPT.test(String(a.originalError)), String(a.originalError))
    }
    {
        const dir = memoryDirectory()
        const { svc } = service(CODE_METHODS, { preview: () => status(404) })
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org-1', () => {}, 's')
        check('Claude Code：盘上没有时照旧 unavailable', result.manifest.assets[0].status === 'unavailable', result.manifest.assets[0].status)
    }

    // —— 五、全部候选失败时，抛出的错误带着每个候选各自的回答 ——
    {
        const { svc } = service(['fetchAttachmentBlob'], { preview: () => status(404) })
        let thrown = null
        try {
            await svc.fetchAttachmentBlob([
                { url: '/api/organizations/o/files/u/contents', variant: 'original' },
                { url: '/api/o/files/u/preview', variant: 'preview' }
            ], 'image/png')
        } catch (error) { thrown = error }
        check('抛出的仍是最后那个错误，status 还在', thrown?.status === 404, String(thrown?.status))
        check('带着每个候选各自的失败', JSON.stringify(thrown?.skipped) === JSON.stringify(['original: 404', 'preview: 404']),
            JSON.stringify(thrown?.skipped))
    }
}
