#!/usr/bin/env bash
# 古诗文闯关 · 管理员本机 Git 同步助手
# 背景：本机 SSH key 未被 GitHub 接受，改走 HTTPS + 钥匙串里存的 PAT。
# token 每次从钥匙串现读、只在本命令内使用，不写进任何文件、不回显。
#
# 用法：
#   ./git-sync.sh push          # 提交后推送当前分支到 origin
#   ./git-sync.sh pull          # 从 origin 拉取当前分支
#   ./git-sync.sh status        # 看远程与本地是否一致（不打印 token）
set -e

REPO_URL="https://github.com/flyingsnowzz/tangshi-game.git"
PW="$(security find-internet-password -s github.com -w 2>/dev/null || true)"
if [ -z "$PW" ]; then
  echo "错误：钥匙串里读不到 github.com 的 token（security find-internet-password -s github.com -w）" >&2
  exit 1
fi
AUTH_URL="https://flyingsnowzz:${PW}@github.com/flyingsnowzz/tangshi-game.git"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

case "${1:-}" in
  push)
    echo "推送 ${BRANCH} -> origin ..."
    GIT_TERMINAL_PROMPT=0 git push "$AUTH_URL" "$BRANCH" 2>&1 | sed "s/${PW}/***/g"
    ;;
  pull)
    echo "拉取 origin -> ${BRANCH} ..."
    GIT_TERMINAL_PROMPT=0 git pull "$AUTH_URL" "$BRANCH" 2>&1 | sed "s/${PW}/***/g"
    ;;
  status)
    echo "远程分支："
    GIT_TERMINAL_PROMPT=0 git ls-remote "$AUTH_URL" 2>/dev/null | sed "s/${PW}/***/g"
    echo "本地 HEAD：$(git rev-parse HEAD)"
    ;;
  *)
    echo "用法：$0 {push|pull|status}" >&2
    exit 1
    ;;
esac
