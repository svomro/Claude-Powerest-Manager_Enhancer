# Claude Powerest Manager & Enhancer (personal fork)

[![Version](https://img.shields.io/badge/Version-1.2.11-blue.svg)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer)
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

### 3. Attachment manifest, and the bytes actually being the attachment

Every export folder now carries an `attachments-manifest.json`: one entry per
reference, with its status, the message it came from, its size, its SHA-256, and —
the field that matters most — `detectedMediaType`, read from the file's own leading
bytes rather than from its name. The manifest names itself the same way the JSON
exports do (`exporter`, `exporter_version`, `artifact_role: attachment_manifest`).

It exists because of what it found. **Measured 2026-09-11 against the live API**:
`preview_url` answers a re-encoded WebP roughly half the size of the original, while
`/api/organizations/<org>/files/<uuid>/contents` answers the source JPEG — and the
downloader tried `preview_url` first. In an existing archive, **245 of 246 images
were WebP previews wearing `.png`/`.jpeg` names**, with nothing on disk saying so.
Original bytes are now preferred and a preview is a labelled last resort.

Re-running an export is **monotonic**: it can improve what is on disk, never degrade
it. That rule had to be learned. An earlier version treated "the bytes disagree with
the extension" as proof of a bad file — but measured 2026-09-12, Claude itself serves
originals that way: two files in a real export are `.png` by name and genuine JPEG by
content, fetched straight from `/contents` and recorded as `variant: original`.
Discarding those would have re-downloaded a perfect file and, once its source blob
expired, replaced it with a preview.

So a mismatch between name and bytes is now **recorded, not acted on**. Two separate
decisions do the work, and keeping them separate is the point:

- *Is a re-fetch worth attempting?* A guess is allowed here. A previous manifest that
  recorded **this attachment** as a preview, or WebP bytes under a name that does not
  say `.webp` — the fingerprint of the old bug — are enough to go and ask for the
  original.
- *May the result replace what is on disk?* No guessing. **Only an original may take
  the place of a file that is already usable.** A preview, or Claude Code's inline
  fallback, lands only where there is nothing usable to lose.

An earlier attempt let the second decision consult the bytes too — a preview could
overwrite anything that looked like WebP. That held for exactly one run: accepting a
file as `existing` dropped the `variant` the previous manifest had recorded, so the
next run re-guessed a known original as a preview and the guard waved it through.
Accepting an existing file now inherits what the previous manifest already recorded
for that attachment, and `tests/monotonic-across-runs.test.cjs` runs the export twice
over the same directory to keep it that way.

That lookup goes by **identity, not by hash**: `fileId`, then `key`, then the local
file name. The hash only confirms that the record found still describes the bytes on
disk. Identical bytes get referenced by different attachments all the time — one real
export has 20 distinct fileIds sharing a single sha256 — so keying previous records by
hash lets the last one win and write another attachment's history into this one. `variant`
describes how *this reference* was obtained; it is not a property of the bytes.

A saved preview is exempt from one check. A local file normally has to match the size
the history declares, because a truncated original still carries a valid header. A
preview is a re-encode and never matches, so every re-run used to judge it broken,
download it again and rewrite it. **Measured 2026-10-10** on a real export: all 17
saved previews of one conversation were rewritten by a run that changed nothing, while
its 14 originals were left alone. The exemption holds only when the previous manifest
recorded exactly these bytes, by hash, as this attachment's preview. Anything else of
the wrong length is still re-fetched, and a saved preview is still replaced the moment
its original answers again.

A re-fetch that fails outright no longer erases a usable local copy from the manifest
either. The entry stays `existing`, keeps its hash and its recorded `variant`, and
`originalError` lists what each candidate answered. Before, the run a saved preview's
URL stopped answering would have recorded it as `unavailable` with no hash while the
file sat on disk. `tests/saved-preview-rerun.test.cjs` gives the attachment its real
declared size; the earlier re-run tests never did, which is why the size check had
never fired in them.

A download is also no longer trusted just because it returned 200. Claude answers a
missing file with `{"type":"error","error":{"type":"not_found_error",…}}`, and a CDN
can answer with an XML error document; either is recorded as a failure with the
server's own message instead of being saved as the attachment. A JSON attachment or
an HTML artifact is unaffected: what the provider declares as a document is taken at
its word.

### Tests

```bash
node tests/run.cjs
```

No dependencies and no framework — the suite pulls the real functions out of
`ClaudePowerestManager&Enhancer.user.js` by name and runs them against stubbed
directory handles and a stubbed API, so it exercises the file that actually ships
rather than a transcription of it. It covers the payload guard, the re-run safety
rules above, the per-candidate retry, and size verification.

### Auditing an export

```bash
node scripts/audit-export.mjs <export-directory>
```

Re-reads every `attachments-manifest.json` under the directory and checks what it
says against what is on disk: every recorded `sha256` is recomputed from the file,
each manifest's own summary counters are re-tallied from its `assets`, and anything
that landed without a hash is reported. It prints the `status` × `variant` census,
the problem conversations with every ERROR and WARN spelled out (which file, and for
a preview each original candidate that was tried and how it failed), and their ids
one per line; it exits non-zero if anything needs looking at. WARN alone does not
fail the audit.

The batch export panel keeps a run log of the same problems, but the two decide
independently and on purpose — the log can only repeat what the manifest claims,
while this reads the bytes. A 357-conversation export on 2026-09-12 had one
attachment the server no longer holds reported as an ERROR by the log and a WARN
here; the disagreement was the bug. Sharing one implementation would have hidden it.

The log counts WARNs per conversation instead of listing them, so a long batch stays
readable. Each `export.conversation.issues` entry carries a `manifest:` field with
the path from the folder you picked down to that conversation's manifest, and the
closing entry says once how to read it: for `variant: preview`, `originalError` says
why the original was not used; for `status: unavailable`, `error` says what the
server answered.

### 4. Claude Artifact HTML downloader (standalone script)

`ClaudeArtifactHTMLDownloader.user.js` — injects a "Download HTML" button in the bottom-right of an Artifact page, picking the most faithful way to save it based on the artifact's type:

| Artifact type | How it is saved | Result |
| --- | --- | --- |
| React / JSX | Reads the source and inlines React, ReactDOM, Tailwind and Babel with it | One file, **interactive even with no network** |
| Complete HTML document | Reads the original source | Keeps comments and branches that never ran |
| Anything else | iframe DOM snapshot | Matches what the page showed |

-   **JSX is compiled when the saved file is opened locally**, not on the claude.ai page: that page's CSP has no `unsafe-eval`, and the policy is inherited by blob workers and `data:` iframes alike, leaving nowhere in the page to run dynamic code. The script itself therefore only performs network requests and string concatenation.
-   Ships mappings for `lucide-react`, `recharts`, `d3`, `lodash`, `papaparse`, `three`, `mathjs` and `tone`; a dependency that cannot be inlined is reported explicitly rather than leaving you with a blank page after download.
-   Web fonts pulled in by the artifact's own source (Google Fonts, typically) are **not** inlined: CJK families are split into hundreds of unicode-range subsets, and one ordinary artifact measured ~12MB of extra weight. Offline, the font falls back to a system serif; nothing else is affected.

### 5. Model alias menu (standalone script, experimental)

`ClaudeModelAliasMenu.user.js` — appends manually specified model id rows under Claude's "More models" submenu.

### 6. Fixes

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
