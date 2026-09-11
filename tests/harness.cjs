// Pulls the real functions out of the real userscript and runs them against stubs.
// Deliberately not a copy: a test that exercises a transcribed copy of the logic
// proves nothing about the file that actually ships.
const fs = require('node:fs')
const path = require('node:path')

const SCRIPT = path.join(__dirname, '..', 'ClaudePowerestManager&Enhancer.user.js')
const source = fs.readFileSync(SCRIPT, 'utf8')

// Everything between the manifest constants and the first unrelated helper: the
// payload guard, the media sniffer, the manifest builder.
function topLevelBlock() {
    const start = source.indexOf('    const ATTACHMENT_MANIFEST_VERSION')
    const end = source.indexOf('    // 全局HTML转义函数')
    if (start < 0 || end < 0) throw new Error('top-level helper block not found')
    return source.slice(start, end)
}

// One method of an object literal, by brace matching.
function method(name) {
    const withAsync = `\n        async ${name}(`
    const plain = `\n        ${name}(`
    const at = source.indexOf(source.indexOf(withAsync) >= 0 ? withAsync : plain)
    if (at < 0) throw new Error(`method not found: ${name}`)
    let i = source.indexOf('{', source.indexOf('(', at + 12))
    let depth = 0
    for (; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') { depth--; if (depth === 0) break }
    }
    return source.slice(at + 1, i + 1)
}

function build(methodNames, context) {
    const body = `${topLevelBlock()}\nconst svc = {\n${methodNames.map(method).join(',\n')}\n};\nreturn svc;`
    return new Function(...Object.keys(context), body)(...Object.values(context))
}

// A FileSystemDirectoryHandle good enough for the export paths.
function memoryDirectory(initial = {}) {
    const files = new Map(Object.entries(initial))
    return {
        files,
        async getFileHandle(name, options) {
            if (!files.has(name) && !options?.create) {
                const error = new Error('missing'); error.name = 'NotFoundError'; throw error
            }
            return {
                getFile: async () => {
                    const blob = files.get(name) ?? new Blob()
                    return Object.assign(blob, { name })
                },
                createWritable: async () => ({
                    write: async value => { files.set(name, value instanceof Blob ? value : new Blob([value])) },
                    close: async () => {}
                })
            }
        }
    }
}

const bytesOf = (...leading) => new Uint8Array([...leading, ...new Array(200).fill(0x41)])
const JPEG = () => new Blob([bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)])
const PNG = () => new Blob([bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)])
const WEBP = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x66, 0xe3, 0, 0, 0x57, 0x45, 0x42, 0x50, ...new Array(80).fill(2)])])

module.exports = { source, topLevelBlock, method, build, memoryDirectory, JPEG, PNG, WEBP }
