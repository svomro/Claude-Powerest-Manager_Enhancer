// 运行日志的两件事：条目怎么排版，什么算「有问题」。
//
// 格式刻意和 chatgpt-archive 的 audit log 对齐（一行抬头 + 缩进字段，多行值用 |
// 起块），两边的日志才能粘进同一个 issue 里对照着看。
//
// 「有问题」的口径是这个功能的全部价值所在：记多了，300 个会话的日志没法看；
// 记少了，出了事查不到是哪个会话。
const { topLevelBlock } = require('./harness.cjs')

const ctx = { t: (key, fallback, ...p) => { let s = fallback === undefined ? key : fallback; p.forEach((v, i) => { s = s.replace(`{${i}}`, v) }); return s },
    Config: { ContentExtractorHandler: [], SpecialContent: [], PdfHandler: [], OutOfContentFileHandler: [] },
    LOG_PREFIX: '[test]', rsplit: (s, sep, n) => { const q = s.split(sep); return [q.slice(0, -n).join(sep), ...q.slice(-n)] },
    ClaudeAPI: {}, EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} } }
const api = new Function(...Object.keys(ctx),
    `${topLevelBlock()}\nreturn { formatAuditLogEntry, deriveManifestIssues };`)(...Object.values(ctx))

const asset = o => ({ status: 'existing', variant: 'original', localFile: 'a.png', fileId: 'f1', error: null, originalError: null, ...o })
// 服务器已经没有这份了的真实形状。照抄 2026-09-12 那次 357 个会话导出里唯一的
// 那条：什么都没拿到，所以 variant/sha256/actualSize 全是 null。
// 用 asset({ status: 'unavailable' }) 会从默认值继承 variant: 'original'——那是
// 现实中不存在的组合，正是它让第一版的判定顺序 bug 从测试里溜了过去。
const goneAsset = o => ({ status: 'unavailable', variant: null, localFile: 'gone.json', fileId: 'f9',
    sha256: null, actualSize: null, originalError: null,
    error: '文件下载失败: 404 at /api/organizations/org/files/f9/contents', ...o })
const man = (...assets) => ({ conversationId: 'c1', assets })

module.exports = async () => {
    const { formatAuditLogEntry: fmt, deriveManifestIssues: derive } = api

    // —— 排版 ——
    check('抬头是 [时间] LEVEL 事件',
        fmt({ timestamp: '2026-09-12T04:00:00.000Z', level: 'ERROR', event: 'export.batch.start' })
        === '[2026-09-12T04:00:00.000Z] ERROR export.batch.start')
    check('单行字段缩进 2 空格',
        fmt({ timestamp: 'T', level: 'INFO', event: 'e', fields: { a: 1 } }) === '[T] INFO e\n  a: 1')
    check('多行值用 | 起块、缩进 4 空格',
        fmt({ timestamp: 'T', level: 'WARN', event: 'e', fields: { ids: 'x\ny' } }) === '[T] WARN e\n  ids: |\n    x\n    y',
        JSON.stringify(fmt({ timestamp: 'T', level: 'WARN', event: 'e', fields: { ids: 'x\ny' } })))
    check('null 写成 null', fmt({ timestamp: 'T', level: 'INFO', event: 'e', fields: { a: null } }) === '[T] INFO e\n  a: null')
    check('undefined 字段整条跳过', fmt({ timestamp: 'T', level: 'INFO', event: 'e', fields: { a: undefined, b: 1 } }) === '[T] INFO e\n  b: 1')
    check('CRLF 归一成 LF',
        fmt({ timestamp: 'T', level: 'INFO', event: 'e', fields: { a: 'x\r\ny' } }) === '[T] INFO e\n  a: |\n    x\n    y')
    check('没有 fields 也不炸', fmt({ timestamp: 'T', level: 'INFO', event: 'e' }) === '[T] INFO e')
    check('false 不被当成空值丢掉', fmt({ timestamp: 'T', level: 'INFO', event: 'e', fields: { a: false } }) === '[T] INFO e\n  a: false')

    // —— 什么不算问题（这条最重要：日志会不会被刷屏） ——
    const quiet = derive(man(
        asset({ status: 'existing', variant: 'original' }),
        asset({ status: 'downloaded', variant: 'original' }),
        asset({ status: 'existing', variant: 'inline' }),
        asset({ status: 'downloaded', variant: 'extracted-text' })))
    check('正常的四种组合一条都不记', quiet.errors.length === 0 && quiet.warnings.length === 0,
        JSON.stringify(quiet))
    check('total 仍统计全部附件', quiet.total === 4)

    // —— ERROR ——
    check('failed 记 ERROR', derive(man(asset({ status: 'failed', error: '404' }))).errors.length === 1)
    check('unresolved 记 ERROR', derive(man(asset({ status: 'unresolved' }))).errors.length === 1)
    check('落了盘却 variant 为 null 记 ERROR（existing）',
        derive(man(asset({ status: 'existing', variant: null }))).errors.length === 1)
    check('落了盘却 variant 为 null 记 ERROR（downloaded）',
        derive(man(asset({ status: 'downloaded', variant: null }))).errors.length === 1)
    check('variant 缺字段也按 null 算',
        derive(man({ status: 'existing', localFile: 'a.png' })).errors.length === 1)
    check('没落盘就不问来路：unavailable 不因 variant 为 null 升级成 ERROR',
        derive(man(goneAsset(), asset({ status: 'downloaded', variant: null }))).errors.length === 1,
        JSON.stringify(derive(man(goneAsset(), asset({ status: 'downloaded', variant: null }))).errors))
    check('failed 优先于 variant 判定，不重复记两条',
        derive(man(asset({ status: 'failed', variant: null }))).errors.length === 1)

    // —— WARN ——
    // 回归：unavailable 天然就是 variant: null，判定顺序一旦让 variant 那支在前，
    // 每个 404 的附件都会被误报成 ERROR。真实导出里撞上过一次。
    const gone = derive(man(goneAsset()))
    check('unavailable 记 WARN 不是 ERROR', gone.warnings.length === 1 && gone.errors.length === 0,
        JSON.stringify({ e: gone.errors, w: gone.warnings }))
    check('unavailable 的 reason 是 unavailable，不是 variant-null', gone.warnings[0]?.reason === 'unavailable', JSON.stringify(gone.warnings[0]))
    check('unavailable 把 404 详情带进 message', /404/.test(gone.warnings[0]?.message || ''))
    check('unavailable 也带 localFile 便于定位', gone.warnings[0]?.localFile === 'gone.json')
    check('preview 记 WARN（拿到了但不是原件）',
        derive(man(asset({ status: 'existing', variant: 'preview' }))).warnings.length === 1)
    check('preview 带上 originalError 当 message',
        derive(man(asset({ variant: 'preview', originalError: 'original: 404' }))).warnings[0]?.message === 'original: 404')

    // —— 定位信息 ——
    const e = derive(man(asset({ status: 'failed', localFile: 'x.png', fileId: 'fid', error: 'boom' }))).errors[0] || {}
    check('错误条目带 localFile', e.localFile === 'x.png')
    check('错误条目带 fileId', e.fileId === 'fid')
    check('错误条目带 message', e.message === 'boom')
    check('fileId 缺失时回落到 key',
        derive(man({ status: 'failed', localFile: 'x', key: 'k1' })).errors[0]?.fileId === 'k1')
    check('variant-null 没有 error 时给出可读理由',
        derive(man(asset({ variant: null, error: null }))).errors[0]?.message === 'log.reason.variantNull')

    // —— 边角 ——
    check('manifest 为 null 不炸', derive(null).total === 0)
    check('manifest 没有 assets 不炸', derive({}).errors.length === 0)
    check('assets 为空数组', derive(man()).total === 0)

    // —— 混合计数 ——
    const mixed = derive(man(
        asset({ status: 'failed' }), asset({ variant: 'preview' }), asset({ variant: 'preview' }),
        goneAsset(), asset({ status: 'existing', variant: 'original' })))
    check('混合：1 error / 3 warning / total 5',
        mixed.errors.length === 1 && mixed.warnings.length === 3 && mixed.total === 5,
        JSON.stringify({ e: mixed.errors.length, w: mixed.warnings.length, t: mixed.total }))
    check('preview 计数可从 warnings 里按 reason 取',
        mixed.warnings.filter(w => w.reason === 'preview').length === 2)
}
