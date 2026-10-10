// 运行日志对 WARN 只给计数、不逐条列，这是刻意的：300 个会话的导出逐条记流水，
// 日志本身就成了要翻的东西。但计数之外，它必须指得出明细在哪。
//
// 反例来自真实使用（2026-10-10）：重导 028f047f，日志写着 preview: 17，看的人
// 只能问「那我去哪儿看是哪 17 个」。答案一直躺在会话目录的 manifest 里，每条都带
// originalError，日志自己却一个字没提。
const { build, source } = require('./harness.cjs')

const UUID = '028f047f-f6ed-4a57-a933-f13771e10365'
const CLEAN = 'ca2a9997-ba15-4285-9f13-91744cfb9b96'
const TITLES = { [UUID]: 'Sonnet 4.6 Claude模型身份澄清', [CLEAN]: 'Opus 4.7 被困在两难之地' }

// 只要建得出子目录、写得进文件的目录句柄
function folder(name) {
    const dirs = new Map()
    return {
        name,
        async getDirectoryHandle(child) { if (!dirs.has(child)) dirs.set(child, folder(child)); return dirs.get(child) },
        async getFileHandle() { return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) } }
    }
}

// 照那份真 manifest 的形状：17 个只剩 preview，14 个原件好好的
const preview = n => ({ status: 'downloaded', variant: 'preview', localFile: `IMG_49${n}.png`, fileId: `p${n}`,
    originalError: `original: 文件下载失败: 404 at /api/organizations/org/files/p${n}/contents` })
const original = n => ({ status: 'existing', variant: 'original', localFile: `IMG_91${n}.jpeg`, fileId: `o${n}` })
const range = n => Array.from({ length: n }, (_, i) => i)
const MANIFESTS = {
    [UUID]: { conversationId: UUID, assets: [...range(17).map(preview), ...range(14).map(original)] },
    [CLEAN]: { conversationId: CLEAN, assets: range(3).map(original) }
}

function makeUI() {
    const entries = []
    const AuditLog = {
        problemIds: [],
        append(event, fields = {}, level = 'INFO') { entries.push({ event, fields, level }) },
        noteProblem(id) { if (!this.problemIds.includes(id)) this.problemIds.push(id) },
        reset() { entries.length = 0; this.problemIds = [] },
        idText() { return this.problemIds.join('\n') }
    }
    const ui = build(['runBatchExport', 'exportSingleConversation'], {
        t: (...a) => String(a[0]),
        AuditLog,
        ManagerService: {
            conversationsCache: Object.entries(TITLES).map(([uuid, name]) => ({ uuid, name })),
            exportAttachmentsForConversation: async history => MANIFESTS[history.uuid],
            transformConversation: data => data
        },
        ClaudeAPI: {
            getConversationHistory: async uuid => ({ uuid, name: TITLES[uuid], chat_messages: [] }),
            getOrganizationInfo: async () => ({ uuid: 'org-1', name: 'tauszxx@gmail.com' })
        },
        withExportProvenance: data => data,
        EXPORTER_NAME: 'x', SCRIPT_VERSION: 'test', console: { warn() {}, error() {} }
    })
    ui.updateStatus = () => {}
    return { ui, entries }
}

const of = (entries, event) => entries.filter(e => e.event === event)

module.exports = async () => {
    // —— 有问题的那一轮 ——
    {
        const { ui, entries } = makeUI()
        await ui.runBatchExport([UUID, CLEAN], folder('Claude'), 'original')
        const issues = of(entries, 'export.conversation.issues')
        check('只有 028f047f 记了一条 issues', issues.length === 1 && issues[0].fields.conversationId === UUID,
            JSON.stringify(issues.map(e => e.fields.conversationId)))
        check('它是 WARN，preview 计 17', issues[0]?.level === 'WARN' && issues[0]?.fields.preview === 17,
            `${issues[0]?.level} / ${issues[0]?.fields.preview}`)
        // 这就是她真实导出落盘的那条路径，从选中的目录名往下数
        const expected = `Claude/Claude_Exports/[tauszxx@gmail.com]/[Original]_[Sonnet 4.6 Claude模型身份澄清]_[${UUID}]/attachments-manifest.json`
        check('issues 指得出 manifest 在哪', issues[0]?.fields.manifest === expected, String(issues[0]?.fields.manifest))
        check('WARN 仍然不逐条记', of(entries, 'export.attachment.issue').length === 0,
            String(of(entries, 'export.attachment.issue').length))
        const complete = of(entries, 'export.batch.complete')[0]
        check('收尾那条说一次怎么读 manifest', complete?.fields.details === 'log.detailsHint', String(complete?.fields.details))
        check('说明只说一次，不挂在每个问题会话下面', !('details' in (issues[0]?.fields || {})))
    }

    // —— 全都正常的一轮：不该多出任何东西 ——
    {
        const { ui, entries } = makeUI()
        await ui.runBatchExport([CLEAN], folder('Claude'), 'original')
        check('没问题就没有 issues', of(entries, 'export.conversation.issues').length === 0)
        const complete = of(entries, 'export.batch.complete')[0]
        check('没问题就不给读 manifest 的说明', complete?.fields.details === undefined, String(complete?.fields.details))
        check('没问题的收尾仍是 INFO', complete?.level === 'INFO', String(complete?.level))
    }

    // —— 自定义导出、不带附件：没有 manifest 可指，也不该炸 ——
    {
        const { ui, entries } = makeUI()
        ui.tempBatchExportSettings = { attachments: { mode: 'none' } }
        await ui.runBatchExport([UUID], folder('Claude'), 'custom')
        const complete = of(entries, 'export.batch.complete')[0]
        check('不带附件的自定义导出照常成功', complete?.fields.succeeded === 1, JSON.stringify(complete?.fields))
        check('不带附件就没有 issues', of(entries, 'export.conversation.issues').length === 0)
    }

    // —— 说明文案两种语言都有，否则日志里露出的是 key ——
    const keyCount = source.split(`'log.detailsHint':`).length - 1
    check('log.detailsHint 中英各一份', keyCount === 2, String(keyCount))
}
