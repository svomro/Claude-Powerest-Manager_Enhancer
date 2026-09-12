// Plain node, no dependencies: `node tests/run.cjs`.
const fs = require('node:fs')
const path = require('node:path')

const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).sort()
let passed = 0, failed = 0
const failures = []

global.check = (label, condition, detail = '') => {
    if (condition) { passed++; return }
    failed++
    failures.push(`${label}${detail ? '  ::  ' + detail : ''}`)
}

;(async () => {
    for (const name of files) {
        const suite = require(path.join(__dirname, name))
        process.stdout.write(`\n── ${name}\n`)
        const before = failed
        // 一个 suite 抛出去不能带塌整轮：剩下的文件就都不跑了，而崩溃看起来
        // 「也算失败了」，很容易被当成测试有效。记成它自己的一条失败，继续往下。
        try { await suite() }
        catch (error) { check(`${name} 抛异常中断`, false, error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)) }
        process.stdout.write(before === failed ? '   全部通过\n' : `   ${failed - before} 条失败\n`)
    }
    console.log(`\n${passed} 通过 / ${failed} 失败`)
    for (const f of failures) console.log('  FAIL ' + f)
    process.exit(failed === 0 ? 0 : 1)
})().catch(error => { console.error('测试运行器崩溃:', error); process.exit(1) })
