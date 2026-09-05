# ClaudeArtifactHTMLDownloader.user.js attribution

`ClaudeArtifactHTMLDownloader.user.js` was adapted from the design and implementation of:

- Ryan Ouyang, **Claude Artifact HTML Downloader**
- https://github.com/Ryan-Ouyang/claude-artifact-html-downloader
- Upstream commit reviewed: `9e42532b11b9303287d8425df710338da11407cf` (2026-07-29)

The upstream project is a Chrome extension that locates the inner `*.frame.claudeusercontent.com` artifact frame, tries to refetch the served HTML, and falls back to serializing the current artifact DOM.

This repository's userscript version reworks that behavior for Tampermonkey, including cross-frame `postMessage` communication, a button injected into Claude's SPA artifact page, route-change handling, and userscript download UI.

The React (JSX) export path added in v1.1.0 is original to this repository and has no upstream counterpart. It recognises `/public/artifacts/<uuid>` pages, reads the artifact source through `/api/published_artifacts/<uuid>`, and inlines the React/ReactDOM/Tailwind/Babel runtimes alongside the untouched JSX so the saved file stays interactive with no network access.

Compilation deliberately happens when the saved file is opened, not while downloading: `claude.ai` ships a CSP without `'unsafe-eval'`, and that policy is also inherited by blob workers and `data:` iframes, so no dynamic code can run in the page. The userscript therefore only performs fetches and string concatenation.

At the time this notice was added, the upstream repository did not contain a `LICENSE` file or another explicit license declaration. The source attribution is recorded here; the `@license MIT` metadata currently present in the userscript header should not be read as relicensing the upstream author's code.
