// ==UserScript==
// @name         Claude Artifact HTML Downloader
// @name:zh-CN   Claude Artifact HTML 下载器
// @namespace    https://github.com/svomro/Claude-Powerest-Manager_Enhancer
// @version      1.1.0
// @description  Download the exact HTML served for a Claude Artifact, with a DOM snapshot fallback. React (JSX) artifacts are compiled into a self-contained offline HTML file.
// @description:zh-CN 下载 Claude Artifact 实际加载的 HTML；React (JSX) 类型会编译成完全离线可交互的单文件 HTML；其余情况保存当前 DOM 快照。
// @author       svomro
// @license      MIT
// @homepageURL  https://github.com/svomro/Claude-Powerest-Manager_Enhancer
// @supportURL   https://github.com/svomro/Claude-Powerest-Manager_Enhancer/issues
// @match        https://claude.ai/*
// @match        https://*.claudeusercontent.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=claude.ai
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      cdnjs.cloudflare.com
// @connect      cdn.jsdelivr.net
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const MESSAGE_NAMESPACE = 'cpm-artifact-html-downloader';
    const REQUEST_TYPE = `${MESSAGE_NAMESPACE}:request`;
    const READY_TYPE = `${MESSAGE_NAMESPACE}:ready`;
    const RESULT_TYPE = `${MESSAGE_NAMESPACE}:result`;
    const BUTTON_ID = 'cpm-artifact-download-button';
    const TOAST_ID = 'cpm-artifact-download-toast';
    const REQUEST_TIMEOUT_MS = 15_000;

    const CODE_ARTIFACT_RE = /^\/code\/artifact\/([0-9a-f-]+)(?:\/|$)/i;
    const PUBLISHED_ARTIFACT_RE = /^\/public\/artifacts\/([0-9a-f-]+)(?:\/|$)/i;
    const REACT_ARTIFACT_TYPE = 'application/vnd.ant.react';

    // 下载时用 Babel 把 JSX 编译掉，所以产物里只需要运行时，不需要再带 2.9MB 的 Babel。
    const BABEL_URL = 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js';
    const RUNTIME_URLS = {
        react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
        reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
        tailwind: 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'
    };

    // Claude 的 React artifact 可用的第三方库 → UMD 产物与它挂到 window 上的全局名。
    const OPTIONAL_LIBRARIES = {
        'lucide-react': { global: 'lucideReact', url: 'https://cdn.jsdelivr.net/npm/lucide-react@0.460.0/dist/umd/lucide-react.min.js' },
        recharts: { global: 'Recharts', url: 'https://cdnjs.cloudflare.com/ajax/libs/recharts/2.13.3/Recharts.min.js' },
        d3: { global: 'd3', url: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js' },
        lodash: { global: '_', url: 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js' },
        papaparse: { global: 'Papa', url: 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js' },
        three: { global: 'THREE', url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.169.0/three.min.js' },
        mathjs: { global: 'math', url: 'https://cdnjs.cloudflare.com/ajax/libs/mathjs/13.2.0/math.min.js' },
        tone: { global: 'Tone', url: 'https://cdnjs.cloudflare.com/ajax/libs/tone/15.0.4/Tone.js' }
    };

    const isClaudeShell = () => location.hostname === 'claude.ai';
    const isArtifactPage = () => CODE_ARTIFACT_RE.test(location.pathname) || PUBLISHED_ARTIFACT_RE.test(location.pathname);
    const isArtifactFrame = () => location.hostname.endsWith('.claudeusercontent.com');

    function serializeDoctype(doctype) {
        if (!doctype) return '<!doctype html>';
        let value = `<!DOCTYPE ${doctype.name}`;
        if (doctype.publicId) value += ` PUBLIC "${doctype.publicId}"`;
        if (doctype.systemId) value += doctype.publicId
            ? ` "${doctype.systemId}"`
            : ` SYSTEM "${doctype.systemId}"`;
        return `${value}>`;
    }

    function sanitizeFilename(value, fallback = 'Claude artifact') {
        const sanitized = String(value || '')
            .normalize('NFKC')
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .trim()
            .slice(0, 120);
        return sanitized || fallback;
    }

    function artifactIdFromPath() {
        const path = location.pathname;
        return path.match(CODE_ARTIFACT_RE)?.[1] || path.match(PUBLISHED_ARTIFACT_RE)?.[1] || '';
    }

    function publishedArtifactId() {
        return location.pathname.match(PUBLISHED_ARTIFACT_RE)?.[1] || '';
    }

    // 页面上下文的 fetch 会被 claude.ai 的 CSP connect-src 挡掉一部分 CDN，
    // 所以优先走 GM_xmlhttpRequest，失败再退回 fetch。
    function fetchText(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) resolve(response.responseText);
                        else reject(new Error(`${url} -> HTTP ${response.status}`));
                    },
                    onerror: () => reject(new Error(`${url} -> network error`)),
                    ontimeout: () => reject(new Error(`${url} -> timeout`)),
                    timeout: 60_000
                });
            });
        }
        return fetch(url).then((response) => {
            if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
            return response.text();
        });
    }

    const assetCache = new Map();
    function fetchTextCached(url) {
        if (!assetCache.has(url)) {
            assetCache.set(url, fetchText(url).catch((error) => {
                assetCache.delete(url);
                throw error;
            }));
        }
        return assetCache.get(url);
    }

    async function fetchPublishedArtifact(artifactId) {
        const response = await fetch(`/api/published_artifacts/${artifactId}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Artifact metadata request failed (HTTP ${response.status}).`);
        const data = await response.json();
        if (typeof data?.content !== 'string') throw new Error('Artifact response did not contain source code.');
        return data;
    }

    // claude.ai 的 CSP 没有 'unsafe-eval'，页面里连 blob Worker 和 data: iframe 都拿不到
    // 能执行动态代码的环境，所以 JSX 不在这里编译 —— Babel 随产物一起打包，
    // 由保存下来的 HTML 在本地打开时自己编译。userscript 全程只做 fetch 和字符串拼接。
    // 每个 import 语句里第一个引号中的内容就是模块名，[^'"] 可跨行，多行 import 也能命中。
    function collectModuleRequests(source) {
        const names = new Set();
        for (const match of source.matchAll(/^[ \t]*import\b[^'"]*?['"]([^'"]+)['"]/gm)) names.add(match[1]);
        for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) names.add(match[1]);
        return [...names];
    }

    function escapeForScriptTag(code) {
        return String(code)
            .replace(/<\/script/gi, '<\\/script')
            .replace(/<!--/g, '<\\!--');
    }

    // 只认完整文档：片段直接存成 .html 会缺 doctype/head，不如退回 DOM 快照。
    function looksLikeHtmlDocument(content) {
        return typeof content === 'string' && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(content);
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 已知且刻意保留的例外：artifact 源码自带的网络字体（常见于 <style> 里的
    // @import Google Fonts）不会被内联。中文字体按 unicode-range 切成几百个分片，
    // 实测一个常见 artifact 就要多背 12MB base64，不值得；断网时字体降级到系统
    // 衬线体，功能不受影响。
    async function buildOfflineReactDocument(artifact, onProgress = () => {}) {
        const requested = collectModuleRequests(artifact.content);
        const builtin = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
        const extras = [];
        const unsupported = [];
        for (const name of requested) {
            if (builtin.has(name)) continue;
            const library = OPTIONAL_LIBRARIES[name];
            if (library) extras.push({ name, ...library });
            else unsupported.push(name);
        }

        onProgress('正在打包运行时…');
        const [react, reactDom, tailwind, babel] = await Promise.all([
            fetchTextCached(RUNTIME_URLS.react),
            fetchTextCached(RUNTIME_URLS.reactDom),
            fetchTextCached(RUNTIME_URLS.tailwind),
            fetchTextCached(BABEL_URL)
        ]);
        const extraSources = await Promise.all(extras.map(async (library) => ({
            ...library,
            source: await fetchTextCached(library.url)
        })));

        const moduleEntries = [
            "'react': React",
            "'react-dom': ReactDOM",
            "'react-dom/client': ReactDOM",
            "'react/jsx-runtime': jsxRuntime",
            "'react/jsx-dev-runtime': jsxRuntime",
            ...extraSources.map((library) => `${JSON.stringify(library.name)}: window[${JSON.stringify(library.global)}]`)
        ];

        const title = artifact.title || 'Claude artifact';
        const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${artifact.description ? `<meta name="description" content="${escapeHtml(artifact.description)}">\n` : ''}<style>
  html, body { margin: 0; padding: 0; }
  #root { min-height: 100vh; }
  #artifact-error {
    margin: 24px; padding: 16px 18px; border-radius: 10px;
    background: #fdf2f2; color: #86211a; border: 1px solid #f3c9c5;
    font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  }
</style>
<script>${escapeForScriptTag(react)}</script>
<script>${escapeForScriptTag(reactDom)}</script>
<script>${escapeForScriptTag(tailwind)}</script>
<script>${escapeForScriptTag(babel)}</script>
${extraSources.map((library) => `<script>${escapeForScriptTag(library.source)}</script>`).join('\n')}
</head>
<body>
<div id="root"></div>
<script>
(function () {
  'use strict';
  // 原始 JSX 原样保留在这里，本地打开时才由上面内联的 Babel 编译。
  var SOURCE = ${escapeForScriptTag(JSON.stringify(artifact.content))};
  var jsxRuntime = {
    jsx: function (type, props, key) { return React.createElement(type, Object.assign({ key: key }, props)); },
    jsxs: function (type, props, key) { return React.createElement(type, Object.assign({ key: key }, props)); },
    Fragment: React.Fragment
  };
  var registry = { ${moduleEntries.join(', ')} };
  function require(name) {
    if (Object.prototype.hasOwnProperty.call(registry, name) && registry[name]) return registry[name];
    throw new Error('This artifact needs the module "' + name + '", which was not bundled.');
  }
  function showError(error) {
    var box = document.createElement('pre');
    box.id = 'artifact-error';
    box.textContent = 'Artifact failed to run:\\n\\n' + (error && error.stack ? error.stack : error);
    document.body.appendChild(box);
  }
  try {
    var compiled = Babel.transform(SOURCE, {
      presets: ['react'],
      plugins: ['transform-modules-commonjs'],
      filename: 'artifact.jsx',
      sourceType: 'module'
    }).code;
    var module = { exports: {} };
    new Function('React', 'ReactDOM', 'require', 'module', 'exports', compiled)(
      React, ReactDOM, require, module, module.exports
    );
    var exported = module.exports;
    var Component = exported && exported.__esModule ? exported.default : exported;
    if (!Component && exported) {
      for (var key in exported) {
        if (typeof exported[key] === 'function') { Component = exported[key]; break; }
      }
    }
    if (typeof Component !== 'function') throw new Error('No React component was exported by this artifact.');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));
  } catch (error) {
    showError(error);
  }
})();
</script>
</body>
</html>
`;

        return { html, unsupported, extras: extras.map((library) => library.name) };
    }

    async function readArtifactHtml() {
        try {
            const response = await fetch(location.href, {
                cache: 'no-store',
                credentials: 'include'
            });
            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
                    return {
                        html: await response.text(),
                        source: 'response'
                    };
                }
            }
        } catch (error) {
            console.debug('[Claude Artifact HTML Downloader] Refetch failed, using DOM snapshot.', error);
        }

        return {
            html: `${serializeDoctype(document.doctype)}\n${document.documentElement.outerHTML}`,
            source: 'dom'
        };
    }

    function frameScore(url, htmlLength = 0) {
        try {
            const parsed = new URL(url);
            return (
                (parsed.hostname.endsWith('.frame.claudeusercontent.com') ? 1_000 : 500)
                + (parsed.pathname.startsWith('/_f/') ? 100 : 0)
                + Math.min(Number(htmlLength || 0) / 100_000, 20)
            );
        } catch {
            return 0;
        }
    }

    function startArtifactFrameBridge() {
        if (window.top === window) return;

        const announceReady = () => {
            window.parent.postMessage({
                namespace: MESSAGE_NAMESPACE,
                type: READY_TYPE,
                url: location.href,
                title: document.title,
                htmlLength: document.documentElement?.outerHTML?.length || 0
            }, '*');
        };

        window.addEventListener('message', async (event) => {
            if (event.source !== window.parent) return;
            const message = event.data;
            if (!message || message.namespace !== MESSAGE_NAMESPACE || message.type !== REQUEST_TYPE) return;

            try {
                const artifact = await readArtifactHtml();
                window.parent.postMessage({
                    namespace: MESSAGE_NAMESPACE,
                    type: RESULT_TYPE,
                    requestId: message.requestId,
                    ok: true,
                    html: artifact.html,
                    source: artifact.source,
                    url: location.href,
                    title: document.title
                }, '*');
            } catch (error) {
                window.parent.postMessage({
                    namespace: MESSAGE_NAMESPACE,
                    type: RESULT_TYPE,
                    requestId: message.requestId,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                    url: location.href
                }, '*');
            }
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', announceReady, { once: true });
        } else {
            announceReady();
        }
        window.addEventListener('load', announceReady, { once: true });
    }

    function startClaudeShell() {
        const frameCandidates = new Map();
        const pendingRequests = new Map();
        let lastPathname = '';

        GM_addStyle(`
            #${BUTTON_ID} {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-height: 38px;
                padding: 0 14px;
                border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
                border-radius: 999px;
                background: color-mix(in srgb, Canvas 92%, transparent);
                color: CanvasText;
                box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
                backdrop-filter: blur(14px);
                font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
            }
            #${BUTTON_ID}:hover {
                transform: translateY(-1px);
                box-shadow: 0 10px 34px rgba(0, 0, 0, .23);
            }
            #${BUTTON_ID}:disabled {
                cursor: wait;
                opacity: .65;
                transform: none;
            }
            #${BUTTON_ID} svg {
                width: 16px;
                height: 16px;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            #${TOAST_ID} {
                position: fixed;
                right: 20px;
                bottom: 70px;
                z-index: 2147483647;
                max-width: 360px;
                padding: 11px 14px;
                border-radius: 12px;
                background: #222;
                color: #fff;
                box-shadow: 0 8px 28px rgba(0, 0, 0, .24);
                font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
        `);

        function showToast(message, isError = false) {
            // toast 只停留几秒，容易错过；同时留一条控制台记录，事后能查是哪条路径。
            console[isError ? 'error' : 'info']('[Claude Artifact HTML Downloader]', message);
            document.getElementById(TOAST_ID)?.remove();
            const toast = document.createElement('div');
            toast.id = TOAST_ID;
            toast.textContent = message;
            if (isError) toast.style.background = '#b42318';
            document.documentElement.append(toast);
            window.setTimeout(() => toast.remove(), 4_000);
        }

        function makeRequestId() {
            if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
            return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }

        function chooseCandidate() {
            return [...frameCandidates.entries()]
                .sort((left, right) => right[1].score - left[1].score)[0] || null;
        }

        function requestArtifactHtml() {
            return new Promise((resolve, reject) => {
                const requestId = makeRequestId();
                const timeoutId = window.setTimeout(() => {
                    pendingRequests.delete(requestId);
                    reject(new Error('Artifact preview did not answer in time.'));
                }, REQUEST_TIMEOUT_MS);

                pendingRequests.set(requestId, {
                    resolve: (payload) => {
                        window.clearTimeout(timeoutId);
                        resolve(payload);
                    },
                    reject: (error) => {
                        window.clearTimeout(timeoutId);
                        reject(error);
                    }
                });

                const message = {
                    namespace: MESSAGE_NAMESPACE,
                    type: REQUEST_TYPE,
                    requestId
                };
                const candidate = chooseCandidate();
                if (candidate) {
                    candidate[0].postMessage(message, '*');
                    return;
                }

                const frames = [...document.querySelectorAll('iframe')];
                if (!frames.length) {
                    pendingRequests.delete(requestId);
                    window.clearTimeout(timeoutId);
                    reject(new Error('Artifact preview frame was not found.'));
                    return;
                }
                for (const frame of frames) frame.contentWindow?.postMessage(message, '*');
            });
        }

        function resolveDownloadTitle(fallbackTitle) {
            const pageTitle = document.title.replace(/\s*[-–—]\s*Claude\s*$/i, '').trim();
            if (pageTitle && !['Claude', 'Claude Artifact'].includes(pageTitle)) return pageTitle;
            return fallbackTitle || 'Claude artifact';
        }

        function downloadHtml(html, rawTitle) {
            const artifactId = artifactIdFromPath();
            const title = String(rawTitle || 'Claude artifact').replace(/\.(jsx?|tsx?|html?)$/i, '');
            const shortId = artifactId ? artifactId.slice(0, 8) : 'download';
            const filename = `${sanitizeFilename(title)}-${shortId}.html`;
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.style.display = 'none';
            document.documentElement.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
            return filename;
        }

        // 已发布的 artifact 能直接从 API 拿到原始源码：React 编译打包成离线单文件，
        // HTML 直接落原稿（比 iframe 里的 DOM 快照保真，保留注释、脚本和未执行的分支）。
        // 其余类型或取不到源码时返回 false，交回原来的 iframe 快照流程。
        async function tryDownloadPublishedArtifact(setLabel) {
            const artifactId = publishedArtifactId();
            if (!artifactId) return false;

            let artifact;
            try {
                artifact = await fetchPublishedArtifact(artifactId);
            } catch (error) {
                console.debug('[Claude Artifact HTML Downloader] published_artifacts lookup failed, falling back.', error);
                return false;
            }

            if (artifact.type === REACT_ARTIFACT_TYPE) {
                const { html, unsupported, extras } = await buildOfflineReactDocument(artifact, setLabel);
                setLabel('正在保存…');
                const filename = downloadHtml(html, artifact.title);
                const sizeKb = Math.round(new Blob([html]).size / 1024);
                const bundled = extras.length ? `，含 ${extras.join('、')}` : '';
                if (unsupported.length) {
                    showToast(`已下载 ${filename}（${sizeKb}KB）；但 ${unsupported.join('、')} 无法内联，打开后这部分会报错。`, true);
                } else {
                    showToast(`已下载 ${filename}（离线可用，${sizeKb}KB${bundled}）`);
                }
                return true;
            }

            // 不认死 type 字段：只要正文本身就是一份完整 HTML 文档就照原样存。
            // 判不准时宁可落回 iframe 快照，也不存一份残缺的 HTML。
            if (looksLikeHtmlDocument(artifact.content)) {
                setLabel('正在保存…');
                const filename = downloadHtml(artifact.content, artifact.title);
                const sizeKb = Math.round(new Blob([artifact.content]).size / 1024);
                showToast(`已下载 ${filename}（原始源码，${sizeKb}KB）`);
                return true;
            }

            return false;
        }

        function createButton() {
            if (!isArtifactPage() || document.getElementById(BUTTON_ID)) return;
            const button = document.createElement('button');
            button.id = BUTTON_ID;
            button.type = 'button';
            button.title = '下载当前 Claude Artifact 的 HTML';
            button.innerHTML = `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v12"></path>
                    <path d="m7 10 5 5 5-5"></path>
                    <path d="M5 21h14"></path>
                </svg>
                <span>下载 HTML</span>
            `;
            const label = button.querySelector('span');
            const setLabel = (text) => { label.textContent = text; };

            button.addEventListener('click', async () => {
                button.disabled = true;
                setLabel('正在读取…');
                try {
                    const servedFromApi = await tryDownloadPublishedArtifact(setLabel);
                    if (!servedFromApi) {
                        const payload = await requestArtifactHtml();
                        const filename = downloadHtml(payload.html, resolveDownloadTitle(payload.title));
                        const sizeKb = Math.round(new Blob([payload.html]).size / 1024);
                        const via = payload.source === 'dom' ? 'DOM 快照' : 'iframe 源码';
                        showToast(`已下载 ${filename}（${via}，${sizeKb}KB）`);
                    }
                } catch (error) {
                    console.error('[Claude Artifact HTML Downloader]', error);
                    showToast(error instanceof Error ? error.message : String(error), true);
                } finally {
                    button.disabled = false;
                    setLabel('下载 HTML');
                }
            });
            document.documentElement.append(button);
        }

        function syncForRoute() {
            if (location.pathname === lastPathname) return;
            lastPathname = location.pathname;
            frameCandidates.clear();
            if (isArtifactPage()) createButton();
            else document.getElementById(BUTTON_ID)?.remove();
        }

        window.addEventListener('message', (event) => {
            if (!event.origin.endsWith('.claudeusercontent.com')) return;
            const message = event.data;
            if (!message || message.namespace !== MESSAGE_NAMESPACE) return;

            if (message.type === READY_TYPE && event.source) {
                frameCandidates.set(event.source, {
                    url: message.url,
                    title: message.title,
                    score: frameScore(message.url, message.htmlLength)
                });
                return;
            }

            if (message.type !== RESULT_TYPE || !message.requestId) return;
            const pending = pendingRequests.get(message.requestId);
            if (!pending) return;
            pendingRequests.delete(message.requestId);
            if (message.ok && typeof message.html === 'string' && message.html) {
                pending.resolve(message);
            } else {
                pending.reject(new Error(message.error || 'Artifact HTML is empty.'));
            }
        });

        const boot = () => {
            syncForRoute();
            new MutationObserver(() => {
                syncForRoute();
                if (isArtifactPage()) createButton();
            }).observe(document.documentElement, { childList: true, subtree: true });
            window.setInterval(syncForRoute, 500);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
        } else {
            boot();
        }
    }

    if (isArtifactFrame()) startArtifactFrameBridge();
    else if (isClaudeShell()) startClaudeShell();
})();
