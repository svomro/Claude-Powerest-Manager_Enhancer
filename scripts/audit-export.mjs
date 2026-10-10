// 导出目录的事后审计：读每一份 attachments-manifest.json，核对它说的和盘上实际的。
//
//   node scripts/audit-export.mjs <导出目录>
//
// 判定逻辑是**独立实现**的，刻意不从 userscript 里 import。面板上的运行日志判一次、
// 这里判一次，两边对不上就说明有一边错了——2026-09-12 那次 357 个会话的导出里，
// 一个 unavailable 的附件被日志误报成 ERROR，正是这么发现的。共用一份代码就查不出来了。
//
// 另外这里能做日志做不到的事：把每个文件重新 sha256 一遍，和 manifest 记的对。
// 日志只能转述 manifest 的说法，盘上到底是什么它不知道。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const targetDirectory = process.argv[2];
if (!targetDirectory) {
    throw new Error('Usage: node scripts/audit-export.mjs <export-directory>');
}
const root = path.resolve(targetDirectory);

const MANIFEST = 'attachments-manifest.json';

async function findManifests(directory, found = []) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return found; }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await findManifests(full, found);
        else if (entry.name === MANIFEST) found.push(full);
    }
    return found;
}

const sha256 = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

// 什么算问题。ERROR 是这次导出确实没拿到，或者落了盘却说不清来路；WARN 是服务器
// 已经没有这份了，或者拿到的不是原件。unavailable 必须先判——它天然就是 variant: null，
// 「怎么拿到的」对一个根本没落盘的条目不成其为问题。
function classify(asset) {
    const landed = asset.status === 'existing' || asset.status === 'downloaded';
    if (asset.status === 'failed' || asset.status === 'unresolved') return ['ERROR', asset.status];
    if (asset.status === 'unavailable') return ['WARN', 'unavailable'];
    if (landed && asset.variant == null) return ['ERROR', 'variant-null'];
    if (asset.variant === 'preview') return ['WARN', 'preview'];
    return [null, null];
}

const manifests = await findManifests(root);
if (manifests.length === 0) throw new Error(`在 ${root} 下没找到任何 ${MANIFEST}`);

const versions = new Set();
const combos = new Map();
const files = new Map();          // 绝对路径 -> sha，去重用
const redlines = { incomplete: [], missing: [], shaMismatch: [], noHashButLanded: [], countMismatch: [] };
const problems = [];
let assetCount = 0;

for (const manifestPath of manifests.sort()) {
    const dir = path.dirname(manifestPath);
    const label = path.basename(dir);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
    catch (error) { redlines.incomplete.push(`${label} :: manifest 读不了 — ${error.message}`); continue; }

    versions.add(manifest.exporter_version);
    const assets = manifest.assets ?? [];
    if (manifest.complete !== true) redlines.incomplete.push(`${manifest.conversationId} ${label} :: complete=${manifest.complete}`);

    // manifest 自己的汇总字段对不对得上 assets——日志完全看不到这一层。
    const tally = status => assets.filter(a => a.status === status).length;
    for (const [field, actual] of [['expected', assets.length], ['downloaded', tally('downloaded')],
        ['existing', tally('existing')], ['failed', tally('failed')],
        ['unavailable', tally('unavailable')], ['unresolved', tally('unresolved')]]) {
        if (manifest[field] !== actual) redlines.countMismatch.push(`${manifest.conversationId} :: ${field} 写着 ${manifest[field]}，实际 ${actual}`);
    }

    const issue = { id: manifest.conversationId, label, total: assets.length, errors: [], warnings: [] };
    for (const asset of assets) {
        assetCount++;
        combos.set(`${asset.status} / ${asset.variant}`, (combos.get(`${asset.status} / ${asset.variant}`) ?? 0) + 1);

        const [severity, reason] = classify(asset);
        if (severity === 'ERROR') issue.errors.push(`${reason} :: ${asset.localFile} :: ${asset.error ?? asset.originalError ?? ''}`);
        // preview 落了盘，没用上原件的理由在 originalError；unavailable 什么都没拿到，理由在 error。
        else if (severity === 'WARN') issue.warnings.push({
            reason,
            localFile: asset.localFile,
            why: (reason === 'preview' ? asset.originalError : asset.error ?? asset.originalError) ?? ''
        });

        // 盘上核对
        if (asset.sha256 == null) {
            if (asset.status === 'existing' || asset.status === 'downloaded') {
                redlines.noHashButLanded.push(`${manifest.conversationId} :: ${asset.localFile} 状态是 ${asset.status} 却没有 sha256`);
            }
            continue;
        }
        const filePath = path.join(dir, asset.localFile ?? '');
        let actual;
        try { actual = files.get(filePath) ?? await sha256(filePath); }
        catch { redlines.missing.push(`${manifest.conversationId} :: ${asset.localFile}`); continue; }
        files.set(filePath, actual);
        if (actual !== asset.sha256) redlines.shaMismatch.push(`${manifest.conversationId} :: ${asset.localFile}\n      manifest ${asset.sha256}\n      落盘     ${actual}`);
    }
    if (issue.errors.length || issue.warnings.length) problems.push(issue);
}

const count = reason => problems.reduce((sum, p) => sum + p.warnings.filter(w => w.reason === reason).length, 0);
const errorTotal = problems.reduce((sum, p) => sum + p.errors.length, 0);

console.log(`目录          ${root}`);
console.log(`会话          ${manifests.length}`);
console.log(`manifest 条目  ${assetCount}`);
console.log(`落盘去重文件   ${files.size}`);
console.log(`exporter_version  ${[...versions].join(', ')}`);

console.log('\nstatus × variant');
for (const [combo, n] of [...combos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${combo}`);

console.log('\n红线');
const RED = [['complete 不为 true', redlines.incomplete], ['manifest 指向的文件缺失', redlines.missing],
    ['sha256 与落盘不符', redlines.shaMismatch], ['落了盘却没有 sha256', redlines.noHashButLanded],
    ['manifest 汇总字段对不上 assets', redlines.countMismatch]];
for (const [name, list] of RED) {
    console.log(`  ${String(list.length).padStart(4)}  ${name}`);
    for (const item of list.slice(0, 20)) console.log(`        ! ${item}`);
    if (list.length > 20) console.log(`        … 还有 ${list.length - 20} 条`);
}

console.log(`\n问题会话 ${problems.length} 个（ERROR ${errorTotal} 条 / WARN ${count('preview') + count('unavailable')} 条：preview ${count('preview')}、unavailable ${count('unavailable')}）`);
const WARN_SHOWN = 20;
for (const p of problems) {
    console.log(`  [${p.errors.length ? 'ERROR' : 'WARN '}] ${p.id}  附件 ${p.total}，E=${p.errors.length} W=${p.warnings.length}  ${p.label.slice(0, 46)}`);
    for (const e of p.errors) console.log(`          ! ${e}`);
    // 面板日志对 WARN 只给计数。「是哪几个、为什么」在这之前只能自己去翻 manifest。
    for (const w of p.warnings.slice(0, WARN_SHOWN)) {
        console.log(`          ~ ${w.reason} :: ${w.localFile}`);
        // 被跳过的候选在 originalError 里用 ` | ` 连着，一个候选一行才看得清是哪条路断了。
        for (const part of String(w.why).split(' | ').filter(Boolean)) console.log(`              ${part}`);
    }
    if (p.warnings.length > WARN_SHOWN) console.log(`          … 还有 ${p.warnings.length - WARN_SHOWN} 条 WARN`);
}

// 一行一个。和面板上「复制问题 ID」给的应当是同一组 id——顺序未必相同：
// 日志按导出顺序排，这里按目录名排。对不上的是集合，不是顺序。
if (problems.length) {
    console.log('\n问题会话 ID');
    for (const p of problems) console.log(p.id);
}

const fatal = errorTotal + redlines.incomplete.length + redlines.missing.length
    + redlines.shaMismatch.length + redlines.noHashButLanded.length + redlines.countMismatch.length;
console.log(`\n${fatal === 0 ? '通过：没有 ERROR，也没有踩红线。' : `不通过：${fatal} 项需要看。`}`);
process.exit(fatal === 0 ? 0 : 1);
