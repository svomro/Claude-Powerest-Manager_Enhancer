# Claude Powerest Manager & Enhancer（个人 fork）

[![版本](https://img.shields.io/badge/Version-1.2.11-blue.svg)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer)
[![Fork 自](https://img.shields.io/badge/Fork_of-f14XuanLv-lightgrey.svg)](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer)
[![许可证](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/LICENSE)
[![平台](https://img.shields.io/badge/Platform-Tampermonkey-yellow.svg)](https://www.tampermonkey.net/)
[![支持的网站](https://img.shields.io/badge/Site-Claude.ai-orange.svg)](https://claude.ai)

[**Read this document in English**](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/README.md)

> **本仓库 fork 自 [f14XuanLv/Claude-Powerest-Manager_Enhancer](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer)，原作者 [@f14XuanLv](https://github.com/f14XuanLv)。**
>
> 对话管理器、聊天增强器、批量重命名与导出、从任意分支延续、跨分支导航、强制 PDF 深度解析、线性导航面板——**这些上游已有的功能（截至 v1.2.5）请看 [上游 README](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer/blob/main/README_zh.md)**，那里有完整说明和演示动图。
>
> 本文只记录这个 fork 在 v1.2.5 之上新增的部分。

---

## ✨ 本 fork 新增

### 1. Claude Code 会话导出（v1.2.6）

在 Claude Code 的会话页（`claude.ai/code/session_...`）打开右上角的 **Session actions** 菜单，其中会多出一项 **「导出会话」**。

-   抓取会话元数据与全部事件，自动翻页，不受会话长度限制。
-   一并下载会话中的附件，按来源与 UUID 智能命名；已存在的文件会跳过，中断后可继续。
-   目录结构：`Claude_Exports/[组织名]/[ClaudeCode]_[会话标题]_[session_id]/`
-   会话没有标题时，自动取首条用户消息的前 40 字作为文件夹名，避免导出一堆无法区分的 `[Untitled]`。

### 2. 离线会话浏览器

`generate-session-browser.command` 把导出的 JSON 变成一个可离线浏览的 HTML。

-   双击运行后，把导出的会话文件夹拖进终端窗口回车即可；也支持命令行直接传参。
-   拖入的可以是会话文件夹、里面的 `session_*.json`，或是上层目录（会自动向下寻找，有多个时列出让你选）。路径含空格、方括号、`&` 或中文都能正确处理。
-   生成的页面分「官网视图」「消息审计」「全部事件」「附件」四层：既能像官网一样顺畅阅读，也能逐条复核原始数据。

### 3. Claude Artifact HTML 下载器（独立脚本）

`ClaudeArtifactHTMLDownloader.user.js`——在 Artifact 页面右下角注入「下载 HTML」按钮，按 artifact 类型自动选择最保真的保存方式：

| Artifact 类型 | 保存方式 | 结果 |
| --- | --- | --- |
| React / JSX | 读取源码，连同 React、ReactDOM、Tailwind、Babel 一并内联 | 单文件，**断网也能交互** |
| 完整 HTML 文档 | 读取原始源码 | 保留注释与未执行的分支 |
| 其他情况 | iframe DOM 快照 | 与页面所见一致 |

-   **JSX 的编译发生在保存下来的文件被本地打开时**，而不是在 claude.ai 页面上——后者的 CSP 不含 `unsafe-eval`，且该策略会被 blob Worker 与 `data:` iframe 一并继承，页面内没有任何可执行动态代码的角落。因此脚本本身全程只做网络请求与字符串拼接。
-   内置 `lucide-react`、`recharts`、`d3`、`lodash`、`papaparse`、`three`、`mathjs`、`tone` 的映射；遇到无法内联的依赖会明确提示，而不是让你下载完打开一片空白。
-   artifact 源码自带的网络字体（如 Google Fonts）**不会**内联：中文字体按 unicode-range 切成数百个分片，实测一份常见 artifact 就要多背约 12MB。断网时字体降级到系统衬线体，功能不受影响。

### 4. 模型别名菜单（独立脚本，实验性）

`ClaudeModelAliasMenu.user.js`——在 Claude 的 More models 子菜单下追加手动指定的模型 id 行。

### 5. 修复

-   **长会话爆栈**：对话树构建与导出原本用递归遍历，超长会话会触发 `Maximum call stack size exceeded`，改为显式栈的迭代实现。
-   **Manager 按钮遮挡**：Claude Code 会话页与 Artifact 独立页不再显示右下角的 Manager 按钮——这些页面没有对话列表可管，且会与 Artifact 下载按钮重叠。

---

## 🛠️ 安装

1.  先安装 [Tampermonkey](https://www.tampermonkey.net/)。
2.  本 fork 未发布到 Greasy Fork，请从仓库直接安装——点开下面的原始文件链接，Tampermonkey 会自动提示安装：
    -   [主脚本（含 Claude Code 会话导出）](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudePowerestManager%26Enhancer.user.js)
    -   [Artifact HTML 下载器](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudeArtifactHTMLDownloader.user.js)
    -   [模型别名菜单](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/raw/main/ClaudeModelAliasMenu.user.js)

> 只想要上游的稳定版？直接从 [Greasy Fork](https://greasyfork.org/zh-CN/scripts/539886-claudepowerestmanager-enhancer) 安装原作者的版本即可。

三个脚本互不依赖，按需安装。Artifact 下载器需要授予 `GM_xmlhttpRequest` 权限（用于抓取要内联的运行时）。

---

## ⚠️ 注意事项

-   本脚本通过与 Claude 的前端和非公开 API 交互来实现功能。Claude.ai 的页面结构或 API 一旦有较大变化，就可能导致部分功能失效。
-   带附件的导出与 Claude Code 会话导出依赖浏览器的 File System Access API（`showDirectoryPicker`），需要 Chrome、Edge 等 Chromium 内核浏览器；Firefox 与 Safari 暂不支持。
-   `generate-session-browser.command` 需要本机已安装 Node.js。
-   Artifact 下载器保存 JSX 时会内联 Babel，单个文件约 3.4MB；这是为了让文件脱离网络也能运行。

---

## 🤝 致谢

-   **上游项目**：[f14XuanLv/Claude-Powerest-Manager_Enhancer](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer)——本 fork 的全部基础功能来自这里，感谢原作者 [@f14XuanLv](https://github.com/f14XuanLv)。
-   **Artifact 下载器**：设计与实现参考自 [Ryan Ouyang / claude-artifact-html-downloader](https://github.com/Ryan-Ouyang/claude-artifact-html-downloader)，详细归属见 [NOTICE](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/NOTICE-ClaudeArtifactHTMLDownloader.md)。

与上游功能相关的问题，建议直接提到[上游 Issues](https://github.com/f14XuanLv/Claude-Powerest-Manager_Enhancer/issues)；本 fork 新增部分的问题请提到[本仓库 Issues](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/issues)。

---

## 📄 许可 (License)

沿用上游的 [MIT License](https://github.com/svomro/Claude-Powerest-Manager_Enhancer/blob/main/LICENSE)。
