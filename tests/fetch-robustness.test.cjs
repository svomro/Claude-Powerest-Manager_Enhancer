// 原图候选的瞬时故障重试，以及 expectedSize 真正参与验收。
//
// 没有重试时，/contents 上一次 500 或一次网络抖动就会让这张图永久降级成 preview；
// 没有 size 校验时，一个带着完整 JPEG 头、后半截被截断的文件会被判成功。
const { build, JPEG, WEBP } = require('./harness.cjs')

const METHODS = ['fetchAttachmentBlob']

function service(downloadFile) {
    return build(METHODS, {
        t: (...a) => String(a[0]), LOG_PREFIX: '[test]',
        ClaudeAPI: { downloadFile },
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    })
}
const CANDIDATES = [
    { url: '/api/organizations/o/files/u/contents', variant: 'original' },
    { url: '/api/o/files/u/preview', variant: 'preview' }
]
const err = (status, message = String(status)) => { const e = new Error(message); if (status) e.status = status; return e }

module.exports = async function () {
    // 瞬时 500 之后原图成功 —— 不该降级
    {
        let n = 0
        const svc = service(async url => {
            if (url.includes('/contents')) { n++; if (n < 3) throw err(500); return JPEG() }
            return WEBP()
        })
        const t0 = Date.now()
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png')
        check('两次 500 之后仍拿到原图', got.variant === 'original', got.variant)
        check('确实重试了 3 次', n === 3, String(n))
        check('退避是真的等了（>=3s）', Date.now() - t0 >= 3000, `${Date.now() - t0}ms`)
    }

    // 网络错误（没有 status）也算瞬时
    {
        let n = 0
        const svc = service(async url => {
            if (url.includes('/contents')) { n++; if (n < 2) throw new Error('Failed to fetch'); return JPEG() }
            return WEBP()
        })
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png')
        check('无 status 的网络错误按瞬时处理', got.variant === 'original' && n === 2, `${got.variant}/${n}`)
    }

    // 404 是确定答案：立刻换候选，不浪费重试
    {
        let n = 0
        const svc = service(async url => {
            if (url.includes('/contents')) { n++; throw err(404) }
            return WEBP()
        })
        const t0 = Date.now()
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png')
        check('404 后降级到 preview', got.variant === 'preview', got.variant)
        check('404 只试一次，不重试', n === 1, String(n))
        check('没有白等退避（<1s）', Date.now() - t0 < 1000, `${Date.now() - t0}ms`)
        check('跳过原因被记下', /404/.test(got.skipped.join('|')), got.skipped.join('|'))
    }

    // 403 同理
    {
        let n = 0
        const svc = service(async url => { if (url.includes('/contents')) { n++; throw err(403) } return WEBP() })
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png')
        check('403 也不重试', n === 1 && got.variant === 'preview', `${n}/${got.variant}`)
    }

    // expectedSize：长度不符必须拒绝，哪怕文件头是合法 JPEG
    {
        const truncated = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])])
        let previewServed = false
        const svc = service(async url => {
            if (url.includes('/contents')) return truncated
            previewServed = true; return WEBP()
        })
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png', 999999)
        check('截断的原图被 size 校验拒绝', got.variant === 'preview', got.variant)
        check('拒绝理由写明了 size mismatch', /Size mismatch/.test(got.skipped.join('|')), got.skipped.join('|'))
        check('确实退到了 preview', previewServed)
    }

    // expectedSize 相符则放行
    {
        const body = JPEG()
        const svc = service(async () => body)
        const got = await svc.fetchAttachmentBlob(CANDIDATES, 'image/png', body.size)
        check('size 相符则接受', got.variant === 'original', got.variant)
    }

    // 全部候选都失败 → 抛错，不静默
    {
        const svc = service(async () => { throw err(404) })
        let threw = null
        try { await svc.fetchAttachmentBlob(CANDIDATES, 'image/png') } catch (e) { threw = e }
        check('全失败时抛出，不返回空', threw !== null, String(threw))
    }
}
