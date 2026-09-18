#!/bin/bash
# ============================================================================
# APCA · 一键同步到 GitHub
# ----------------------------------------------------------------------------
# 用法:
#   ./tools/sync-to-github.sh                  # 交互式 (推荐)
#   ./tools/sync-to-github.sh -m "fix: ..."    # 自定义 commit message
#   ./tools/sync-to-github.sh --skip-verify    # 跳过五件套校验 (不建议)
#   ./tools/sync-to-github.sh --dry-run        # 只检查不推送
# ----------------------------------------------------------------------------
# 行为:
#   1. 检查工作目录干净 (无未提交修改)
#   2. (可选) 跑五件套校验, 任一 FAIL 则中止
#   3. 自动从 tools/build-web-data.js 读版本号, 生成 commit message
#   4. git push origin main
# ============================================================================

set -e

# ---- 路径与常量 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

# Node 路径: 优先 PATH 上的 node, 否则回退到 macOS WorkBuddy managed node
NODE="$(command -v node || true)"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  if [[ -x "/Users/jmount/.workbuddy/binaries/node/versions/22.22.2-2/bin/node" ]]; then
    NODE="/Users/jmount/.workbuddy/binaries/node/versions/22.22.2-2/bin/node"
  else
    echo "✗ 未找到 node, 请先安装 Node.js"; exit 1
  fi
fi

# ---- 参数解析 ----
SKIP_VERIFY=0
DRY_RUN=0
CUSTOM_MSG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) CUSTOM_MSG="$2"; shift 2;;
    --skip-verify) SKIP_VERIFY=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) head -20 "$0" | tail -16; exit 0;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

# ---- 颜色 ----
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; CYA='\033[0;36m'; NC='\033[0m'
info()  { printf "${CYA}ℹ %s${NC}\n" "$*"; }
ok()    { printf "${GRN}✓ %s${NC}\n" "$*"; }
warn()  { printf "${YEL}⚠ %s${NC}\n" "$*"; }
err()   { printf "${RED}✗ %s${NC}\n" "$*"; }

# ---- 工具检查 ----
command -v git >/dev/null 2>&1 || { err "git 未安装"; exit 1; }
[ -x "$NODE" ] || { err "node 未就绪: $NODE"; exit 1; }
[ -d .git ] || { err "当前目录不是 git 仓库, 请先 git init"; exit 1; }
git remote -v | grep -q "github.com" || { err "未关联 GitHub 远程仓库, 请按 GITHUB.md §1.3 配置"; exit 1; }

# ---- 1. 工作目录检查 ----
info "[1/5] 检查工作目录..."
if [[ -n $(git status --porcelain) ]]; then
  err "工作目录有未提交修改, 请先 git add + commit 或 stash"
  echo "--- 当前变更 ---"
  git status --short
  exit 1
fi
ok "工作目录干净"

# ---- 2. 五件套校验 ----
if [[ $SKIP_VERIFY -eq 0 ]]; then
  info "[2/5] 跑五件套校验 (verify-web / dom / wiring / merge / server)..."
  SUITES=(verify-web verify-web-dom verify-wiring verify-merge verify-server)
  FAIL=0
  for s in "${SUITES[@]}"; do
    if "$NODE" "tools/$s.js" > /tmp/apca-$s.log 2>&1; then
      PASS=$(grep -oE '结果: [0-9]+ PASS' /tmp/apca-$s.log | head -1)
      ok "$s: ${PASS:-PASS}"
    else
      FAIL=1
      err "$s: FAIL (详见 /tmp/apca-$s.log)"
    fi
  done
  [[ $FAIL -eq 0 ]] || { err "校验未全绿, 推送中止. 用 --skip-verify 可跳过 (不建议)"; exit 1; }
else
  warn "[2/5] 已跳过五件套校验 (--skip-verify)"
fi

# ---- 3. 读版本号 ----
info "[3/5] 读取当前版本号..."
VERSION=$("$NODE" -e "const fs=require('fs');const s=fs.readFileSync('tools/build-web-data.js','utf8');const m=s.match(/questionSetVersion:\s*'([^']+)'/);process.stdout.write(m?m[1]:'unknown')")
[ -n "$VERSION" ] || { err "无法从 build-web-data.js 读出版本号"; exit 1; }
ok "当前版本: $VERSION"

# ---- 4. 准备 commit ----
info "[4/5] 准备提交..."
if [[ -z "$CUSTOM_MSG" ]]; then
  # 默认 commit message: 带版本号 + 简易变更摘要 (取系统更新日志最后一段标题)
  if [ -f 系统更新日志.md ]; then
    SUMMARY=$(awk '/^## \[/{t=$0; getline; gsub(/[*_]/,"",$0); print substr($0,1,80); exit}' 系统更新日志.md 2>/dev/null)
  fi
  MSG="v${VERSION#v} · ${SUMMARY:-本地代码同步}"
else
  MSG="$CUSTOM_MSG"
fi

# 检查是否有新提交需要推送
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)

if [[ "$AHEAD" -eq 0 && "$BEHIND" -eq 0 ]]; then
  ok "本地与远程同步, 无需推送"
  exit 0
fi

if [[ "$BEHIND" -gt 0 ]]; then
  warn "远程领先本地 $BEHIND 个提交, 建议先 git pull --rebase"
  if [[ $DRY_RUN -eq 0 ]]; then
    # 非交互环境(stdin 不是终端, 如定时任务/被其他程序调用)下没有人在键盘边按 y,
    # read 会一直阻塞到进程被杀。这里统一按「保守答案」处理: 覆盖远程 = 取消。
    if [[ ! -t 0 ]]; then
      warn "非交互环境, 不等待确认; 覆盖远程有风险, 已取消 (请先 git pull --rebase)"
      exit 0
    fi
    read -p "是否继续 (强行推送)? [y/N] " -n 1 -r; echo
    [[ $REPLY =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }
  fi
fi

# 远程没有新提交, 本地有
if [[ "$AHEAD" -gt 0 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    info "DRY-RUN: 将推送 $AHEAD 个提交:"
    git log --oneline origin/main..HEAD
    info "DRY-RUN: commit message 将为: $MSG"
    exit 0
  fi

  # 同上: 非交互环境下不等键盘, 走该项的默认答案 Y(正常场景就是往前推)。
  if [[ ! -t 0 ]]; then
    info "非交互环境, 跳过确认, 直接推送 $AHEAD 个提交"
    REPLY="y"
  else
    read -p "推送 $AHEAD 个提交到 origin/main? [Y/n] " -n 1 -r; echo
  fi
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    info "推送中..."
    git push origin main
    ok "推送完成"
  else
    info "已取消"
    exit 0
  fi
fi

# ---- 5. 推送后验证 ----
info "[5/5] 推送后验证..."
REMOTE_URL=$(git remote get-url origin)
WEB_URL="${REMOTE_URL%.git}"
info "GitHub 仓库: $WEB_URL"
info "请在浏览器打开确认"

ok "同步完成 🎉"