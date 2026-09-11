// 搜索框既搜标题也搜会话 ID，但不能因此把标题搜索淹掉。
//
// 关键取舍：只有输入里出现「至少 8 位连续 hex」才当成 id 探针。UUID 的头一段正好
// 8 位；而搜 "a"、"ff" 这种短词时，几乎每个 UUID 里都有——真按子串去撞 uuid，
// 结果列表会被一堆标题毫不相干的会话灌满，等于把原来的标题搜索废掉。
const { build } = require('./harness.cjs')

const METHODS = ['idProbe', 'matchesSearch', 'escapeRegExp']
const UUID = '028f047f-f6ed-4a57-a933-f13771e10365'

const CONVOS = [
    { uuid: UUID, name: 'Sonnet 4.6 Claude模型身份澄清' },
    { uuid: 'ca2a9997-ba15-4285-9f13-91744cfb9b96', name: 'Opus 4.7 被困在两难之地' },
    { uuid: '2069716e-0ce6-4e3d-a307-9ec235935a1d', name: 'Finding recipes for your lifestyle' },
    { uuid: '3c908ff2-db26-4ca3-bb4b-f4e8a678fab5', name: 'Fable 5' },
    { uuid: 'abcdef01-0000-4000-8000-000000000000', name: '没有名字的那个' }
]

function service() {
    return build(METHODS, {
        t: (...a) => String(a[0]), Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
        LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const p = s.split(sep); return [p.slice(0, -n).join(sep), ...p.slice(-n)] },
        ClaudeAPI: {}, EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    })
}

// 按面板里真正的那条路径过滤：标题正则 + id 探针
function search(svc, input) {
    const titlePattern = new RegExp(svc.escapeRegExp(input), 'i')
    const probe = svc.idProbe(input)
    return CONVOS.filter(c => svc.matchesSearch(c, titlePattern, probe)).map(c => c.name)
}

module.exports = async () => {
    const svc = service()

    // —— 探针提取本身 ——
    check('裸 UUID 整条都是探针', svc.idProbe(UUID) === UUID, svc.idProbe(UUID))
    check('URL 里只抠出 UUID，域名不算',
        svc.idProbe(`https://claude.ai/chat/${UUID}`) === UUID, svc.idProbe(`https://claude.ai/chat/${UUID}`))
    check('导出目录名里的 [uuid] 能抠出来',
        svc.idProbe(`[Original]_[Fable 5]_[3c908ff2-db26-4ca3-bb4b-f4e8a678fab5]`) === '3c908ff2-db26-4ca3-bb4b-f4e8a678fab5',
        svc.idProbe(`[Original]_[Fable 5]_[3c908ff2-db26-4ca3-bb4b-f4e8a678fab5]`))
    check('大写 UUID 归一成小写', svc.idProbe(UUID.toUpperCase()) === UUID)
    check('UUID 第一段（8 位）就够当探针', svc.idProbe('028f047f') === '028f047f')
    check('尾随斜杠不进探针', svc.idProbe(`https://claude.ai/chat/${UUID}/`) === UUID, svc.idProbe(`https://claude.ai/chat/${UUID}/`))

    // —— 短词不许触发 id 匹配 ——
    for (const short of ['a', 'ff', 'abc', 'cafe', 'deadbee', '模型']) {
        check(`短词 "${short}" 不产生探针`, svc.idProbe(short) === '', `得到 "${svc.idProbe(short)}"`)
    }
    check('搜 "a" 只按标题走，不会把所有含 a 的 uuid 拖出来',
        search(svc, 'a').every(n => /a/i.test(n)), JSON.stringify(search(svc, 'a')))
    check('搜 "ff" 不命中 3c908ff2 那条（标题 Fable 5 里没有 ff）',
        !search(svc, 'ff').includes('Fable 5'), JSON.stringify(search(svc, 'ff')))

    // —— 按 id 搜 ——
    check('裸 UUID 精确命中一条', JSON.stringify(search(svc, UUID)) === JSON.stringify(['Sonnet 4.6 Claude模型身份澄清']), JSON.stringify(search(svc, UUID)))
    check('粘整条 URL 也命中同一条', JSON.stringify(search(svc, `https://claude.ai/chat/${UUID}`)) === JSON.stringify(['Sonnet 4.6 Claude模型身份澄清']))
    check('粘导出目录名命中 Fable 5', JSON.stringify(search(svc, '[Original]_[Fable 5]_[3c908ff2-db26-4ca3-bb4b-f4e8a678fab5]')) === JSON.stringify(['Fable 5']))
    check('大写 UUID 一样命中', JSON.stringify(search(svc, UUID.toUpperCase())) === JSON.stringify(['Sonnet 4.6 Claude模型身份澄清']))
    check('前后空格不影响（标题正则不会中，靠探针）',
        JSON.stringify(search(svc, `  ${UUID}  `)) === JSON.stringify(['Sonnet 4.6 Claude模型身份澄清']), JSON.stringify(search(svc, `  ${UUID}  `)))
    check('只给前 8 位也命中', JSON.stringify(search(svc, '028f047f')) === JSON.stringify(['Sonnet 4.6 Claude模型身份澄清']))
    check('不存在的 id 返回空', search(svc, '99999999-0000-0000-0000-000000000000').length === 0)

    // —— 标题搜索没被动过 ——
    check('标题搜索照旧', JSON.stringify(search(svc, 'Fable')) === JSON.stringify(['Fable 5']))
    check('标题搜索大小写不敏感', JSON.stringify(search(svc, 'fable')) === JSON.stringify(['Fable 5']))
    check('中文标题照旧', JSON.stringify(search(svc, '两难')) === JSON.stringify(['Opus 4.7 被困在两难之地']))
    check('标题里的正则元字符被转义，不当模式用', search(svc, 'Fable.5').length === 0, JSON.stringify(search(svc, 'Fable.5')))

    // —— 边角 ——
    check('name 缺失不抛错', svc.matchesSearch({ uuid: UUID }, /zzz/i, '') === false)
    check('uuid 缺失不抛错', svc.matchesSearch({ name: 'x' }, /zzz/i, '028f047f') === false)
    check('探针为空时绝不碰 uuid', svc.matchesSearch({ uuid: UUID, name: 'x' }, /zzz/i, '') === false)
}
