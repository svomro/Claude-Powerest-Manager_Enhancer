import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const targetDirectory = process.argv[2];
if (!targetDirectory) {
    throw new Error('Usage: node scripts/build-code-session-browser.mjs <export-directory>');
}

const directory = path.resolve(targetDirectory);
const entries = await fs.readdir(directory, { withFileTypes: true });
const jsonFiles = entries
    .filter(entry => entry.isFile() && /^session_.+\.json$/i.test(entry.name))
    .map(entry => entry.name)
    .sort();

if (jsonFiles.length === 0) {
    throw new Error(`No session_*.json file found in ${directory}`);
}

const sourceFileName = jsonFiles.at(-1);
const sourcePath = path.join(directory, sourceFileName);
const sourceText = await fs.readFile(sourcePath, 'utf8');
const exportData = JSON.parse(sourceText);
if (!Array.isArray(exportData.events)) {
    throw new Error(`${sourceFileName} does not contain an events array.`);
}

const mimeByExtension = {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp'
};

const attachments = [];
for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    const mimeType = mimeByExtension[extension];
    if (!mimeType) continue;

    const stat = await fs.stat(path.join(directory, entry.name));
    const match = entry.name.match(/^attachment-(\d+)-(\d+)_\[([^\]]+)\]/i);
    attachments.push({
        name: entry.name,
        size: stat.size,
        mimeType,
        eventNumber: match ? Number(match[1]) : null,
        blockNumber: match ? Number(match[2]) : null,
        messageUuid: match ? match[3] : null
    });
}
attachments.sort((a, b) => (a.eventNumber ?? Number.MAX_SAFE_INTEGER) - (b.eventNumber ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

// This page embeds the whole session JSON, so a scanner that only looks at size or
// content could easily read it as a record. It is a viewer: say so in the page, with
// the same field names the JSON artifacts carry.
const userscriptPath = path.join(scriptDirectory, '..', 'ClaudePowerestManager&Enhancer.user.js');
let exporterVersion = 'unknown';
try {
    const header = await fs.readFile(userscriptPath, 'utf8');
    exporterVersion = header.match(/^\/\/ @version\s+(\S+)/m)?.[1] ?? 'unknown';
} catch {
    // Built from a copy that does not sit next to the userscript; the role still holds.
}
const escapeAttribute = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
const provenanceMeta = [
    ['generator', `claude-powerest-manager-enhancer ${exporterVersion}`],
    ['exporter', 'claude-powerest-manager-enhancer'],
    ['exporter_version', exporterVersion],
    ['artifact_role', 'code_session_browser']
].map(([name, content]) => `    <meta name="${name}" content="${escapeAttribute(content)}">`).join('\n');
const templatePath = path.join(scriptDirectory, 'code-session-browser-template.html');
let html = await fs.readFile(templatePath, 'utf8');

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const replacements = new Map([
    ['__SOURCE_FILE_NAME__', sourceFileName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')],
    ['__ATTACHMENT_DATA__', safeJson(attachments)],
    ['__SESSION_DATA__', safeJson(exportData)],
    ['__PROVENANCE_META__', provenanceMeta]
]);

for (const [placeholder, value] of replacements) {
    const count = html.split(placeholder).length - 1;
    if (count !== 1) throw new Error(`Expected one ${placeholder} placeholder, found ${count}.`);
    html = html.replace(placeholder, () => value);
}

const outputPath = path.join(directory, 'session-browser.html');
await fs.writeFile(outputPath, html, 'utf8');

console.log(JSON.stringify({
    outputPath,
    sourceFileName,
    exporterVersion,
    eventCount: exportData.events.length,
    attachmentCount: attachments.length,
    outputBytes: Buffer.byteLength(html)
}, null, 2));
