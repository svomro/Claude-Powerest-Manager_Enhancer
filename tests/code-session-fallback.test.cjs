// Claude Code 的远端候选全失败后会回落到消息里的内联图。那也是 fallback，不是原图，
// 所以必须守同一条规则：不覆盖任何 usable 的已有文件。
const { build, memoryDirectory, JPEG, PNG, WEBP } = require('./harness.cjs')

const METHODS = [
    'exportCodeSessionAttachments', 'collectCodeSessionAttachments', 'parseInlineImage',
    'getImageExtension', 'buildCodeAttachmentFileName', 'sanitizeFileNamePart', 'inlineImageToBlob',
    'fileExists', 'writeFileToDirectory', 'inspectExistingAttachment', 'fetchAttachmentBlob',
    'recordAttachmentBytes', 'existingCopyIsDowngraded', 'mayReplaceExisting',
    'inheritRecordedProvenance', 'readPreviousManifest'
]
const PNG_B64 = Buffer.from(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, ...new Array(40).fill(7)])).toString('base64')

function service(remote) {
    const fetched = []
    return {
        fetched,
        svc: build(METHODS, {
            t: (...a) => String(a[0]), LOG_PREFIX: '[test]',
            atob: x => Buffer.from(x, 'base64').toString('binary'),
            ClaudeAPI: { async downloadFile(url) { fetched.push(url); const r = remote(url); if (r instanceof Error) throw r; return r } },
            EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
        })
    }
}
const exportData = () => ({ session: { uuid: 's' }, events: [{
    payload: {
        file_attachments: [{ file_uuid: 'u-dead', file_name: 'shot.png', is_image: true }],
        message: { content: [{ type: 'image', file_uuid: 'u-dead', source: { media_type: 'image/png', data: PNG_B64 } }] }
    }
}] })
const dead = () => { const e = new Error('404'); e.status = 404; return e }

module.exports = async function () {
    // 已有一个 usable 的 JPEG（被 WebP 启发式之外的原因留在盘上）
    {
        const name = 'shot_[u-dead].png'
        const dir = memoryDirectory({ [name]: JPEG() })
        const size = dir.files.get(name).size
        const { svc, fetched } = service(() => dead())
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org', () => {}, 's')
        const a = result.manifest.assets[0]
        check('usable 的 JPEG 直接保留，连下载都不发起', a.status === 'existing' && fetched.length === 0, `${a.status}/${fetched.length}`)
        check('盘上字节没变', dir.files.get(name).size === size, `${dir.files.get(name).size} vs ${size}`)
    }

    // 1b. 真正触发 fallback 护栏：本地是 WebP（会被判成疑似降级，于是去回源），
    // 远端死了，只剩 inline fallback —— 此时必须挡住。
    {
        const name = 'shot_[u-dead].png'
        const dir = memoryDirectory({ [name]: WEBP() })
        const size = dir.files.get(name).size
        const { svc, fetched } = service(() => dead())
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org', () => {}, 's')
        const a = result.manifest.assets[0]
        check('确实尝试过回源（护栏是第二道）', fetched.length > 0, String(fetched.length))
        check('inline fallback 没有覆盖已有文件', a.status === 'existing', `${a.status}/${a.variant}`)
        check('盘上字节没变', dir.files.get(name).size === size, `${dir.files.get(name).size} vs ${size}`)
        check('说明了为什么没换', /kept the existing/.test(String(a.originalError)), String(a.originalError))
        check('远端失败原因也保留了', /404/.test(String(a.originalError)), String(a.originalError))
    }

    // 盘上什么都没有 → fallback 正常落盘
    {
        const dir = memoryDirectory({})
        const { svc } = service(() => dead())
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org', () => {}, 's')
        const a = result.manifest.assets[0]
        check('空位时 inline fallback 正常落盘', a.status === 'downloaded' && a.variant === 'inline-fallback', `${a.status}/${a.variant}`)
        check('写进去的确实是 PNG', a.detectedMediaType === 'image/png', String(a.detectedMediaType))
    }

    // 远端 original 活着 → 允许升级覆盖（护栏不该把升级也挡掉）
    {
        const name = 'shot_[u-dead].png'
        const dir = memoryDirectory({ [name]: WEBP() })
        const { svc } = service(url => url.includes('/contents') ? PNG() : dead())
        const result = await svc.exportCodeSessionAttachments(exportData(), dir, 'org', () => {}, 's')
        const a = result.manifest.assets[0]
        check('拿到 original 时旧 WebP 被升级', a.status === 'downloaded' && a.variant === 'original', `${a.status}/${a.variant}`)
        check('盘上换成了 PNG', a.detectedMediaType === 'image/png', String(a.detectedMediaType))
    }
}
