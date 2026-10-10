// 审计脚本对 WARN 也要逐条说清：是哪个文件，原件那条路是怎么断的。
//
// 面板日志对 WARN 只给计数。这之前审计脚本也一样，只打 E= W= 两个数，ERROR
// 才逐条展开；于是「17 个 preview 是哪 17 个」只能自己去翻 manifest。
// 这里真起一个 node 进程跑脚本，断言的是人在终端里看到的东西。
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'audit-export.mjs')
const UUID = '028f047f-f6ed-4a57-a933-f13771e10365'

// 一个会话目录：文件真写下去，sha256 照实记，红线才不会被测试自己踩响
function exportDir(assets) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-audit-'))
    const dir = path.join(root, 'Claude_Exports', '[org]', `[Original]_[Sonnet 4.6 Claude模型身份澄清]_[${UUID}]`)
    fs.mkdirSync(dir, { recursive: true })
    const recorded = assets.map(({ bytes, ...asset }) => {
        if (!bytes) return { sha256: null, ...asset }
        fs.writeFileSync(path.join(dir, asset.localFile), bytes)
        return { ...asset, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    })
    const tally = status => recorded.filter(a => a.status === status).length
    fs.writeFileSync(path.join(dir, 'attachments-manifest.json'), JSON.stringify({
        exporter_version: 'test', conversationId: UUID, complete: true,
        expected: recorded.length, downloaded: tally('downloaded'), existing: tally('existing'),
        failed: tally('failed'), unavailable: tally('unavailable'), unresolved: tally('unresolved'),
        assets: recorded
    }))
    return root
}

function audit(assets) {
    const root = exportDir(assets)
    try { return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' }) }
    finally { fs.rmSync(root, { recursive: true, force: true }) }
}

const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
// 真 manifest 里的原话：两条原件候选都 404，用 ` | ` 连着
const BOTH_404 = 'original: 文件下载失败: 404 at /api/organizations/org/files/7bc81e4e/contents'
    + ' | original: 文件下载失败: 404 at /api/org/files/7bc81e4e/document_jpeg/Zeta_20260201183647.jpeg'
const PREVIEW = 'Zeta_20260201183647_[7bc81e4e].jpeg'

module.exports = async () => {
    const run = audit([
        { status: 'downloaded', variant: 'preview', localFile: PREVIEW, bytes: WEBP, originalError: BOTH_404 },
        { status: 'existing', variant: 'original', localFile: 'IMG_9101_[29fe4146].jpeg', bytes: JPEG },
        { status: 'unavailable', variant: null, localFile: 'gone_[f9].json', error: '文件下载失败: 404 at /api/organizations/org/files/f9/contents' }
    ])
    const lines = run.stdout.split('\n')
    check('只有 WARN 不算不通过', run.status === 0, `exit ${run.status}\n${run.stdout}${run.stderr}`)
    check('preview 逐条列出文件名', lines.includes(`          ~ preview :: ${PREVIEW}`), run.stdout)
    check('被跳过的候选一个一行',
        lines.includes(`              ${BOTH_404.split(' | ')[0]}`) && lines.includes(`              ${BOTH_404.split(' | ')[1]}`),
        run.stdout)
    check('unavailable 也逐条列，理由取 error', lines.includes('          ~ unavailable :: gone_[f9].json')
        && lines.includes('              文件下载失败: 404 at /api/organizations/org/files/f9/contents'), run.stdout)
    check('好好的原件不出现在 WARN 明细里', !run.stdout.includes('~ original') && !/~ .*IMG_9101/.test(run.stdout), run.stdout)
    check('汇总计数没被改坏', run.stdout.includes('WARN 2 条：preview 1、unavailable 1'), run.stdout)

    // 一个会话几十个 preview 时只列前 20 个，剩下的说个数
    const many = audit(Array.from({ length: 25 }, (_, i) => ({
        status: 'downloaded', variant: 'preview', localFile: `p${String(i).padStart(2, '0')}.png`,
        bytes: Buffer.concat([WEBP, Buffer.from([i])]), originalError: 'original: 404'
    })))
    const listed = many.stdout.split('\n').filter(line => line.startsWith('          ~ preview :: ')).length
    check('单个会话最多列 20 条 WARN', listed === 20, String(listed))
    check('剩下的说个数', many.stdout.includes('… 还有 5 条 WARN'), many.stdout)
}
