#!/usr/bin/env bash
# 累積する docs/knowledge/{audit-log,test-log}/ を直近 KEEP 件のみアクティブに保つ。
# それ以前は docs/knowledge/archive/<name>/ に退避してエージェントの参照対象から外す。
#
# Usage:
#   ./scripts/rotate_logs.sh [audit-log|test-log|all]
#   KEEP=5 ./scripts/rotate_logs.sh
#
# agents.sh の run_tester / run_auditor 末尾から自動呼び出しされる。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOWLEDGE="$REPO_ROOT/docs/knowledge"
ARCHIVE="$KNOWLEDGE/archive"
KEEP="${KEEP:-3}"

log() { echo "[rotate_logs] $*"; }

rotate_one() {
  local name="$1"
  local src_dir="$KNOWLEDGE/$name"
  local dst_dir="$ARCHIVE/$name"

  [[ -d "$src_dir" ]] || return 0

  # 対象ファイルを更新時刻の新しい順に収集
  local files=()
  while IFS= read -r f; do
    files+=("$f")
  done < <(find "$src_dir" -maxdepth 1 -type f -name '*.md' -printf '%T@ %p\n' | sort -rn | awk '{print $2}')

  local total=${#files[@]}
  if (( total <= KEEP )); then
    log "$name: $total 件 (KEEP=$KEEP) — 退避不要"
    return 0
  fi

  mkdir -p "$dst_dir"

  local moved=0
  for ((i=KEEP; i<total; i++)); do
    mv "${files[i]}" "$dst_dir/"
    ((moved++)) || true
  done
  log "$name: $moved 件を archive へ退避（直近 $KEEP 件保持）"
}

target="${1:-all}"
case "$target" in
  audit-log) rotate_one audit-log ;;
  test-log)  rotate_one test-log ;;
  all)
    rotate_one audit-log
    rotate_one test-log
    ;;
  *)
    echo "Usage: $0 [audit-log|test-log|all]"
    exit 1
    ;;
esac
