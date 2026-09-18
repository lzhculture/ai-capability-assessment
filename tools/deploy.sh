#!/usr/bin/env bash
# =============================================================================
# APCA · 公网机上线脚本（目标主机由环境变量指定，仓库内不保存任何地址）
# =============================================================================
# 用法：
#   APCA_SSH_HOST=你的主机别名 bash tools/deploy.sh
#   bash tools/deploy.sh --dry-run         # 只列将要变更的文件，不实际操作
#   bash tools/deploy-lzhu.sh --dry-run    # 只列将要变更的文件，不实际操作
#   bash tools/deploy.sh --no-restart      # 只同步不重启（手工挑时机时用）
#
# 环境变量：
#   APCA_SSH_HOST   必填，SSH 主机别名（写在 ~/.ssh/config 里）
#   APCA_REMOTE_DIR 服务器上的部署目录（默认 /srv/apca）
#   APCA_PUBLIC_URL 对外访问地址，用于上线后探活（不设则只查本机端口）
#
# 为什么必须有这个脚本（2026-09-18 的真实教训）：
#   手工敲 rsync 时，如果写成
#     rsync -avz web/ server/ 系统更新日志.md 主机别名:部署目录/
#   rsync 会把多个源「平铺」合并到目标根目录 —— server/server.js 会被丢到
#   部署目录/server.js，而本地 server/data/records.json（测试数据，约 2KB）
#   会直接覆盖线上真实答题记录（当时 32 条 / 32KB）。一旦覆盖不可恢复。
#   所以本脚本强制：① 目录对目录分开同步 ② 永远排除 server/data/
#   ③ 同步前先备份线上数据与旧服务文件。
#
# 设计：
#   - 幂等，可重复跑
#   - 不写死凭证、IP、域名与目录，全部由环境变量传入
#   - 失败不沉默（set -euo pipefail）
# =============================================================================

set -euo pipefail

REMOTE="${APCA_SSH_HOST:-}"
REMOTE_HOME="${APCA_REMOTE_DIR:-/srv/apca}"
PUBLIC_URL="${APCA_PUBLIC_URL:-}"

if [[ -z "$REMOTE" ]]; then
  echo "✗ 未指定目标主机。" >&2
  echo "  用法：APCA_SSH_HOST=你的主机别名 bash tools/deploy.sh" >&2
  echo "  （主机别名写在 ~/.ssh/config 里，仓库内不保存任何服务器地址）" >&2
  exit 1
fi
SERVICE="apca"
DRY_RUN=0
DO_RESTART=1

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --no-restart) DO_RESTART=0 ;;
    -h|--help)    sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# 定位项目根（脚本在 tools/ 下）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RSYNC_OPTS=(-avz --exclude '.DS_Store' --exclude 'node_modules/' --exclude '.git/')
[[ $DRY_RUN -eq 1 ]] && RSYNC_OPTS+=(--dry-run)

echo "=============================================================="
echo " APCA 上线 → $REMOTE:$REMOTE_HOME   $([[ $DRY_RUN -eq 1 ]] && echo '[DRY-RUN 只预览]')"
echo "=============================================================="

# ---------- 0. 前置检查：SSH 通不通 ----------
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "true" 2>/dev/null; then
  echo "[FATAL] 连不上 $REMOTE。内网机不通时属正常，等网络恢复再跑。" >&2
  exit 1
fi

LOCAL_VER="$(grep -oE 'v0\.[0-9]+\.[0-9]+' web/data.js | sort -u | tail -1)"
REMOTE_VER="$(ssh -o BatchMode=yes "$REMOTE" "grep -oE 'v0\.[0-9]+\.[0-9]+' $REMOTE_HOME/web/data.js 2>/dev/null | sort -u | tail -1" || echo '未知')"
echo "  本地版本: $LOCAL_VER"
echo "  线上版本: $REMOTE_VER"
echo

# ---------- 1. 备份（dry-run 时跳过）----------
if [[ $DRY_RUN -eq 0 ]]; then
  echo "[1/4] 备份线上数据与旧服务文件..."
  ssh -o BatchMode=yes "$REMOTE" \
    "sudo cp -a $REMOTE_HOME/server/data/records.json \
        $REMOTE_HOME/server/data/records.json.bak-\$(date +%Y%m%d%H%M) && \
     sudo cp -a $REMOTE_HOME/server/server.js \
        $REMOTE_HOME/server/server.js.bak-\$(date +%Y%m%d%H%M) && \
     echo '     备份 OK'"
else
  echo "[1/4] 备份（dry-run 跳过）"
fi

# ---------- 2. 三路同步（目录对目录，绝不合并平铺）----------
echo "[2/4] 同步文件（排除 server/data/ ...）"
echo "  --- web/ ---"
rsync "${RSYNC_OPTS[@]}" web/ "$REMOTE:$REMOTE_HOME/web/" | grep -vE '^sent|^total|^$|^Transfer' || true

echo "  --- server/ ---"
rsync "${RSYNC_OPTS[@]}" --exclude 'data/' server/ "$REMOTE:$REMOTE_HOME/server/" | grep -vE '^sent|^total|^$|^Transfer' || true

echo "  --- 系统更新日志.md ---"
if [[ $DRY_RUN -eq 0 ]]; then
  rsync -avz 系统更新日志.md "$REMOTE:$REMOTE_HOME/" | grep -vE '^sent|^total|^$|^Transfer' || true
else
  rsync -avz --dry-run 系统更新日志.md "$REMOTE:$REMOTE_HOME/" | grep -vE '^sent|^total|^$|^Transfer' || true
fi

# ---------- 3. 重启 ----------
if [[ $DRY_RUN -eq 1 ]]; then
  echo "[3/4] 重启（dry-run 跳过）"
elif [[ $DO_RESTART -eq 1 ]]; then
  echo "[3/4] 重启 $SERVICE ..."
  ssh -o BatchMode=yes "$REMOTE" "sudo systemctl restart $SERVICE; sleep 3; sudo systemctl is-active $SERVICE"
else
  echo "[3/4] 按 --no-restart 跳过重启"
fi

# ---------- 4. 验证 ----------
if [[ $DRY_RUN -eq 0 && $DO_RESTART -eq 1 ]]; then
  echo "[4/4] 线上验证..."
  ssh -o BatchMode=yes "$REMOTE" "
    echo '  版本:   '\$(grep -oE 'v0\.[0-9]+\.[0-9]+' $REMOTE_HOME/web/data.js | sort -u | tail -1)
    echo '  首页:   '\$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:8787/)'
    if [[ -n "$PUBLIC_URL" ]]; then echo '  对外:   '\$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUBLIC_URL"); fi
    echo '  ping:   '\$(curl -s -m 8 http://127.0.0.1:8787/api/ping)
    echo '  记录数: '\$(/usr/local/bin/node -e \"const d=require('$REMOTE_HOME/server/data/records.json');console.log((Array.isArray(d)?d.length:Object.keys(d).length)+' 条')\")
    echo '  硬编码口令残留: '\$(grep -c 'apca2026' $REMOTE_HOME/server/server.js || true)
  "
  echo
  echo "提示：记录数应与上线前一致。若变少，说明数据被覆盖，"
  echo "      立刻用同目录 records.json.bak-* 回滚。"
else
  echo "[4/4] 验证（跳过）"
fi

echo
echo "完成。"
