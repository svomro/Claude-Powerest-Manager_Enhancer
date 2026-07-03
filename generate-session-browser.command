#!/bin/zsh

set -uo pipefail

SCRIPT_DIR="${0:A:h}"
INTERACTIVE=0

if [[ -z "${1:-}" ]]; then
    INTERACTIVE=1
    trap 'print ""; print "按回车键关闭窗口..."; read -r _ || true' EXIT
fi

clean_path() {
    local input="$1"
    input="${input## }"
    input="${input%% }"
    input="${input#\'}"
    input="${input%\'}"
    input="${input#\"}"
    input="${input%\"}"
    if [[ "$input" == file://* ]]; then
        input="${input#file://}"
        input="$(printf '%b' "${input//%/\\x}")"
    fi
    input=$(printf '%s' "$input" | sed 's/\\\(.\)/\1/g')
    input="${input%/}"
    print -r -- "$input"
}

find_session_dir() {
    local root="$1"
    if ls "$root"/session_*.json >/dev/null 2>&1; then
        print -r -- "$root"
        return 0
    fi
    local -a matches
    matches=("$root"/**/session_*.json(N))
    if (( ${#matches} == 0 )); then
        return 1
    fi
    local -A seen
    for f in $matches; do
        seen[${f:h}]=1
    done
    local -a dirs
    dirs=(${(k)seen})
    if (( ${#dirs} == 1 )); then
        print -r -- "${dirs[1]}"
        return 0
    fi
    print -u2 "❌ 目录里包含多个会话，请选一个具体的拖进来："
    for d in $dirs; do
        print -u2 "   - $d"
    done
    return 2
}

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    print "把 Claude Code 导出的「会话文件夹」拖到这里，然后按回车："
    print "（就是那个名字类似 [ClaudeCode]_[标题]_[session_xxx] 的文件夹）"
    print ""
    printf "> "
    IFS= read -r TARGET
fi

TARGET="$(clean_path "$TARGET")"

if [[ -z "$TARGET" ]]; then
    print -u2 "❌ 没有输入路径。"
    exit 1
fi

if [[ -f "$TARGET" && "$TARGET" == *.json ]]; then
    TARGET="${TARGET:h}"
fi

if [[ ! -d "$TARGET" ]]; then
    print -u2 "❌ 找不到这个路径："
    print -u2 "   $TARGET"
    print -u2 ""
    print -u2 "   请把「[ClaudeCode]_[标题]_[session_xxx]」这一级文件夹整个拖进来。"
    exit 1
fi

RESOLVED="$(find_session_dir "$TARGET")"
STATUS=$?
if (( STATUS != 0 )); then
    if (( STATUS == 1 )); then
        print -u2 "❌ 这个文件夹里没有 session_*.json："
        print -u2 "   $TARGET"
        print -u2 ""
        print -u2 "   请确认拖进来的是导出脚本生成的「[ClaudeCode]_[标题]_[session_xxx]」这一级。"
    fi
    exit 1
fi
TARGET="$RESOLVED"

if ! command -v node >/dev/null 2>&1; then
    print -u2 "❌ 找不到 Node.js。"
    print -u2 "   请任选一种方式安装："
    print -u2 "   • brew install node"
    print -u2 "   • 从 https://nodejs.org 下载官方安装包"
    exit 1
fi

print ""
print "🔧 正在生成 HTML..."
print "   目标目录：$TARGET"
print ""

if node "$SCRIPT_DIR/scripts/build-code-session-browser.mjs" "$TARGET"; then
    print ""
    print "✅ 已生成：$TARGET/session-browser.html"
    print "   直接双击这个 HTML 文件就能在浏览器里查看。"
else
    print -u2 ""
    print -u2 "❌ 生成失败，请把上面的错误信息发给我。"
    exit 1
fi
