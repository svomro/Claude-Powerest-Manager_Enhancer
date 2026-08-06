// ==UserScript==
// @name         Claude Artifact HTML Downloader
// @name:zh-CN   Claude Artifact HTML 下载器
// @namespace    https://github.com/svomro/Claude-Powerest-Manager_Enhancer
// @version      1.0.0
// @description  Download the exact HTML served for a Claude Artifact, with a DOM snapshot fallback.
// @description:zh-CN 下载 Claude Artifact 实际加载的 HTML；无法重新请求时保存当前 DOM 快照。
// @author       svomro
// @license      MIT
// @homepageURL  https://github.com/svomro/Claude-Powerest-Manager_Enhancer
// @supportURL   https://github.com/svomro/Claude-Powerest-Manager_Enhancer/issues
// @match        https://claude.ai/*
// @match        https://*.claudeusercontent.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=claude.ai
// @grant        GM_addStyle
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

    const isClaudeShell = () => location.hostname === 'claude.ai';
    const isArtifactPage = () => /^\/code\/artifact\/[0-9a-f-]+(?:\/|$)/i.test(location.pathname);
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
        return location.pathname.match(/^\/code\/artifact\/([0-9a-f-]+)/i)?.[1] || '';
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

        function downloadHtml(payload) {
            const artifactId = artifactIdFromPath();
            const title = document.title && !['Claude', 'Claude Artifact'].includes(document.title.trim())
                ? document.title.trim()
                : payload.title || 'Claude artifact';
            const shortId = artifactId ? artifactId.slice(0, 8) : 'download';
            const filename = `${sanitizeFilename(title)}-${shortId}.html`;
            const blob = new Blob([payload.html], { type: 'text/html;charset=utf-8' });
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
            button.addEventListener('click', async () => {
                button.disabled = true;
                button.querySelector('span').textContent = '正在读取…';
                try {
                    const payload = await requestArtifactHtml();
                    const filename = downloadHtml(payload);
                    showToast(`已下载 ${filename}${payload.source === 'dom' ? '（DOM 快照）' : ''}`);
                } catch (error) {
                    console.error('[Claude Artifact HTML Downloader]', error);
                    showToast(error instanceof Error ? error.message : String(error), true);
                } finally {
                    button.disabled = false;
                    button.querySelector('span').textContent = '下载 HTML';
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
