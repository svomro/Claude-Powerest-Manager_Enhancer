# Claude Powerest Manager & Enhancer (personal fork)

[![Version](https://img.shields.io/badge/Version-1.2.6-blue.svg)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer)
[![Fork of](https://img.shields.io/badge/Fork_of-f14XuanLv-lightgrey.svg)](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Tampermonkey-yellow.svg)](https://www.tampermonkey.net/)
[![Site](https://img.shields.io/badge/Site-Claude.ai-orange.svg)](https://claude.ai)

[**阅读中文版文档**](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/README_zh.md)

> **This repository is a fork of [f14XuanLv/Claude-Powerest-Manager_Enhancer](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer), originally written by [@f14XuanLv](https://github.com/f14XuanLv).**
>
> The conversation manager, chat enhancer, bulk rename and export, branching from any node, cross-branch navigation, forced PDF deep analysis, linear navigation panel — **everything the upstream project already provides (as of v1.2.5) is documented in the [upstream README](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer/blob/main/README.md)**, complete with demo recordings.
>
> This document only covers what this fork adds on top of v1.2.5.

---

## ✨ What this fork adds

### 1. Claude Code session export (v1.2.6)

On a Claude Code session page (`claude.ai/code/session_...`), open the **Session actions** menu in the top-right corner — an **"Export session"** entry is added to it.

-   Fetches session metadata and every event, paginating automatically so session length is not a limit.
-   Downloads the session's attachments alongside it, named after their origin and UUID; files that already exist are skipped, so an interrupted export can be resumed.
-   Directory layout: `Claude_Exports/[Org]/[ClaudeCode]_[Session Title]_[session_id]/`
-   When a session has no title, the first 40 characters of the opening user message become the folder name instead — no more piles of indistinguishable `[Untitled]` folders.

### 2. Offline session browser

`generate-session-browser.command` turns an exported JSON into a self-contained HTML page you can read offline.

-   Double-click it, then drag the exported session folder into the terminal window and press Enter; passing the path as a command-line argument works too.
-   You can drop in the session folder, the `session_*.json` inside it, or a parent directory (it searches downwards, and lists the candidates when there is more than one). Paths containing spaces, brackets, `&` or CJK characters are handled correctly.
-   The generated page has four layers — "site view", "message audit", "all events" and "attachments" — so you can read it like the real site while still being able to verify every raw record.

### 3. Claude Artifact HTML downloader (standalone script)

`ClaudeArtifactHTMLDownloader.user.js` — injects a "Download HTML" button in the bottom-right of an Artifact page, picking the most faithful way to save it based on the artifact's type:

| Artifact type | How it is saved | Result |
| --- | --- | --- |
| React / JSX | Reads the source and inlines React, ReactDOM, Tailwind and Babel with it | One file, **interactive even with no network** |
| Complete HTML document | Reads the original source | Keeps comments and branches that never ran |
| Anything else | iframe DOM snapshot | Matches what the page showed |

-   **JSX is compiled when the saved file is opened locally**, not on the claude.ai page: that page's CSP has no `unsafe-eval`, and the policy is inherited by blob workers and `data:` iframes alike, leaving nowhere in the page to run dynamic code. The script itself therefore only performs network requests and string concatenation.
-   Ships mappings for `lucide-react`, `recharts`, `d3`, `lodash`, `papaparse`, `three`, `mathjs` and `tone`; a dependency that cannot be inlined is reported explicitly rather than leaving you with a blank page after download.
-   Web fonts pulled in by the artifact's own source (Google Fonts, typically) are **not** inlined: CJK families are split into hundreds of unicode-range subsets, and one ordinary artifact measured ~12MB of extra weight. Offline, the font falls back to a system serif; nothing else is affected.

### 4. Model alias menu (standalone script, experimental)

`ClaudeModelAliasMenu.user.js` — appends manually specified model id rows under Claude's "More models" submenu.

### 5. Fixes

-   **Stack overflow on long sessions**: conversation-tree building and export used recursive traversal, which threw `Maximum call stack size exceeded` on very long sessions. Rewritten as iteration over an explicit stack.
-   **Manager button in the way**: the bottom-right Manager button is no longer rendered on Claude Code session pages or standalone Artifact pages — neither has a conversation list to manage, and it overlapped the Artifact download button.

---

## 🛠️ Installation

1.  Install [Tampermonkey](https://www.tampermonkey.net/) first.
2.  This fork is not published on Greasy Fork — install straight from the repository. Opening a raw file link below will prompt Tampermonkey to install it:
    -   [Main script (includes Claude Code session export)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudePowerestManager%26Enhancer.user.js)
    -   [Artifact HTML downloader](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudeArtifactHTMLDownloader.user.js)
    -   [Model alias menu](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudeModelAliasMenu.user.js)

> Just want the upstream stable release? Install the original author's version from [Greasy Fork](https://greasyfork.org/en/scripts/539886-claudepowerestmanager-enhancer).

The three scripts are independent of one another; install whichever you need. The Artifact downloader requires the `GM_xmlhttpRequest` permission, which it uses to fetch the runtimes it inlines.

---

## ⚠️ Important Notes

-   These scripts work by interacting with Claude's front-end and private APIs. A significant change to the structure of claude.ai or its APIs can break parts of them.
-   Exports that include attachments, as well as Claude Code session export, rely on the browser's File System Access API (`showDirectoryPicker`). A Chromium-based browser such as Chrome or Edge is required; Firefox and Safari are not supported yet.
-   `generate-session-browser.command` requires Node.js to be installed locally.
-   Saving a JSX artifact inlines Babel, making the file roughly 3.4MB. That is the price of a file that keeps working with no network at all.

---

## 🤝 Acknowledgments

-   **Upstream project**: [f14XuanLv/Claude-Powerest-Manager_Enhancer](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer) — every bit of this fork's baseline functionality comes from there. Thanks to [@f14XuanLv](https://github.com/f14XuanLv).
-   **Artifact downloader**: adapted from the design and implementation of [Ryan Ouyang / claude-artifact-html-downloader](https://github.com/Ryan-Ouyang/claude-artifact-html-downloader); see [NOTICE](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/NOTICE-ClaudeArtifactHTMLDownloader.md) for the full attribution.

For issues with upstream functionality, please report them to [upstream Issues](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer/issues); for anything this fork added, use [this repository's Issues](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/issues).

---

## 📄 License

Inherits the upstream [MIT License](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/LICENSE).
