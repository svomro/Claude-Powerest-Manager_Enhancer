// 200 不等于「这就是附件」。判定只在两种情况下拒绝：provider 声明的是二进制媒体
// 而 body 是结构化文本，或者 body 是已知的错误信封且 provider 没声明它是文档。
// 声明为 json/xml/html/text 的一律放行——这是真 JSON 附件和 HTML artifact 不被误伤的原因。

// 顶层块里的函数不需要 this，但 buildAttachmentManifest 用到两个常量，要注入。
const { topLevelBlock } = require('./harness.cjs')
const { describeErrorPayload, sniffMediaType, extensionMediaType, buildAttachmentManifest } =
    new Function('EXPORTER_NAME', 'SCRIPT_VERSION', topLevelBlock() +
        '\nreturn { describeErrorPayload, sniffMediaType, extensionMediaType, buildAttachmentManifest };')(
        'claude-powerest-manager-enhancer', 'test')

const CLAUDE_404 = '{"type":"error","error":{"type":"not_found_error","message":"Missing files"},"request_id":"req_1"}'
const AZURE = String.fromCharCode(0xFEFF) + '<?xml version="1.0"?><Error><Code>ServerBusy</Code><Message>Egress is over the account limit.</Message></Error>'
const B = (...n) => new Uint8Array(n)

module.exports = async function () {
    check('JPEG 头被认出', sniffMediaType(B(0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46)) === 'image/jpeg')
    check('PNG 头被认出', sniffMediaType(B(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)) === 'image/png')
    check('WebP 头被认出', sniffMediaType(B(0x52,0x49,0x46,0x46,0x66,0xe3,0,0,0x57,0x45,0x42,0x50)) === 'image/webp')
    check('扩展名映射', extensionMediaType('IMG.png') === 'image/png')

    check('Claude 的 404 信封被拒（声明为图片）',
        /not_found_error/.test(String(describeErrorPayload({ declaredMimeType: 'image/jpeg', head: CLAUDE_404 }))))
    check('Claude 的 404 信封被拒（什么都没声明）',
        /not_found_error/.test(String(describeErrorPayload({ declaredMimeType: null, head: CLAUDE_404 }))))
    check('Azure 的 XML 错误文档被拒',
        /ServerBusy/.test(String(describeErrorPayload({ declaredMimeType: 'image/png', head: AZURE }))))

    check('真 JSON 附件放行',
        describeErrorPayload({ declaredMimeType: 'application/json', head: CLAUDE_404 }) === null)
    check('真 HTML artifact 放行',
        describeErrorPayload({ declaredMimeType: 'text/html', head: '<!DOCTYPE html><html></html>' }) === null)
    check('extracted-text 存成 .txt 的放行',
        describeErrorPayload({ declaredMimeType: 'text/plain', head: '{ 看着像 json 其实是 txt }' }) === null)
    check('真二进制字节放行',
        describeErrorPayload({ declaredMimeType: 'image/jpeg', head: String.fromCharCode(0xFF,0xD8,0xFF) + ' binary' }) === null)
    check('octet-stream 不构成证据',
        describeErrorPayload({ declaredMimeType: 'application/octet-stream', head: '{"data":true}' }) === null)

    const m = buildAttachmentManifest('conv', [{ status: 'downloaded' }, { status: 'unavailable' }])
    check('清单自证身份', m.exporter === 'claude-powerest-manager-enhancer' && m.artifact_role === 'attachment_manifest')
    check('清单有独立 schema 版本', m.version === 1, String(m.version))
    check('unavailable 不阻断 complete', m.complete === true)
    check('failed 阻断 complete', buildAttachmentManifest('c', [{ status: 'failed' }]).complete === false)
    check('unresolved 阻断 complete', buildAttachmentManifest('c', [{ status: 'unresolved' }]).complete === false)
}
