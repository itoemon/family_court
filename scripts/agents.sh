#!/usr/bin/env bash
# Usage: ./scripts/agents.sh <architect|engineer|tester|auditor>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOWLEDGE="$REPO_ROOT/docs/knowledge"
AGENTS_DIR="$REPO_ROOT/docs/agents"

# ── ユーティリティ ────────────────────────────────────────────────────────────

log() { echo "[agents.sh] $*"; }
die() { echo "[agents.sh] ERROR: $*" >&2; exit 1; }

require_claude() {
  command -v claude   &>/dev/null || die "'claude' CLI が見つかりません。インストールしてください。"
  command -v envsubst &>/dev/null || die "'envsubst' が見つかりません。macOS: brew install gettext && brew link gettext --force"
}

# Supabase Management API 経由で SQL を実行する
# Usage: supabase_execute <sql>
# 環境変数 SUPABASE_ACCESS_TOKEN と SUPABASE_PROJECT_REF が必要
supabase_execute() {
  local sql="$1"
  local token="${SUPABASE_ACCESS_TOKEN:-}"
  local project_ref="${SUPABASE_PROJECT_REF:-}"

  [[ -n "$token" ]]       || die "SUPABASE_ACCESS_TOKEN が未設定です"
  [[ -n "$project_ref" ]] || die "SUPABASE_PROJECT_REF が未設定です"

  local payload
  payload="$(jq -n --arg q "$sql" '{query: $q}')"

  local response
  response="$(curl -sf -X POST \
    "https://api.supabase.com/v1/projects/${project_ref}/database/query" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$payload")"

  echo "$response"
}

# supabase/migrations/ 配下の未適用マイグレーションを実行する
# ファイル名: YYYYMMDDHHMMSS_<name>.sql（タイムスタンプ昇順で実行）
# 適用済み管理: supabase/migrations/applied.txt に記録
run_migrations() {
  local migrations_dir="$REPO_ROOT/supabase/migrations"
  local applied_file="$migrations_dir/applied.txt"

  [[ -d "$migrations_dir" ]] || return 0

  touch "$applied_file"

  local applied_count=0
  for sql_file in "$migrations_dir"/*.sql; do
    [[ -f "$sql_file" ]] || continue
    local fname
    fname="$(basename "$sql_file")"
    if grep -qxF "$fname" "$applied_file" 2>/dev/null; then
      continue
    fi
    log "マイグレーションを適用します: $fname"
    local sql_content
    sql_content="$(cat "$sql_file")"
    supabase_execute "$sql_content" > /dev/null
    echo "$fname" >> "$applied_file"
    ((applied_count++)) || true
  done

  [[ "$applied_count" -gt 0 ]] && log "マイグレーション完了（${applied_count}件）" || true
}

# プロンプトファイルを読み込み、環境変数を展開して返す
# Usage: load_prompt <agent_name> [VAR=value ...]
load_prompt() {
  local agent="$1"; shift
  local prompt_file="$AGENTS_DIR/${agent}.md"
  [[ -f "$prompt_file" ]] || die "プロンプトファイルが見つかりません: $prompt_file"

  # 呼び出し元から渡された変数を export
  for kv in "$@"; do
    export "${kv?}"
  done
  export REPO_ROOT

  # ${VAR} 形式のプレースホルダーを展開（未定義変数はそのまま残す）
  envsubst < "$prompt_file"
}

# 監査通過後、MEDIUM/LOW の未修正指摘を docs/backlog.md の「未対応」セクションに追記する
_append_backlog() {
  local audit_file="$1"
  local backlog="$REPO_ROOT/docs/backlog.md"
  local audit_basename
  audit_basename="$(basename "$audit_file")"

  [[ -f "$backlog" ]] || return 0

  local medium_low_count
  medium_low_count=$(grep -c '### \[MEDIUM-\|### \[LOW-' "$audit_file" 2>/dev/null) || medium_low_count=0
  [[ "$medium_low_count" -eq 0 ]] && return 0

  log "未修正の MEDIUM/LOW 指摘を backlog.md に追記します..."

  local entries
  entries="$(grep -A6 '### \[MEDIUM-\|### \[LOW-' "$audit_file" | sed "s|$| (由来: $audit_basename)|")"

  local tmp
  tmp="$(awk -v block="$entries" '
    /^---$/ && found {
      print block
      print ""
      found=0
    }
    /^## 未対応/ { found=1 }
    { print }
  ' "$backlog")"
  echo "$tmp" > "$backlog"

  log "backlog.md を更新しました（+${medium_low_count}件）"
}

# ── アーキ ────────────────────────────────────────────────────────────────────
# 入力: docs/knowledge/requirements.md
# 出力: docs/knowledge/design.md + handoff/arch-to-eng.md

run_architect() {
  local req_file="$KNOWLEDGE/requirements.md"
  local out_file="$KNOWLEDGE/design.md"

  [[ -f "$req_file" ]] || die "要件定義書が見つかりません: $req_file"

  log "アーキを起動します..."

  claude -p "$(load_prompt architect OUT_FILE="$out_file")" \
    --allowedTools "Write,Read,Glob"

  log "設計書を出力しました: $out_file"
}

# ── ビルド ────────────────────────────────────────────────────────────────────
# 入力: docs/knowledge/design.md
# 出力: feature ブランチにコミット済みコード + handoff/eng-to-aud.md

run_engineer() {
  local design_file="$KNOWLEDGE/design.md"
  [[ -f "$design_file" ]] || die "設計書が見つかりません: $design_file"

  local branch="feature/$(date +%Y%m%d-%H%M%S)"
  git -C "$REPO_ROOT" checkout -b "$branch"
  log "ブランチを作成しました: $branch"

  log "ビルドを起動します（ブランチ: $branch）..."

  claude -p "$(load_prompt engineer)" \
    --allowedTools "Edit,Write,Bash,Read,Glob,Grep"

  # supabase/migrations/ に新規 SQL があれば自動適用
  run_migrations

  log "実装完了（ブランチ: $branch）"
  echo "$branch"
}

# ── テスタ ────────────────────────────────────────────────────────────────────
# 入力: 実装コード + design.md + requirements.md
# 出力: docs/knowledge/test-log/test_YYYYMMDD_HHMMSS.md
# 戻り値: 0=通過, 1=失敗（ビルドに差し戻し）

run_tester() {
  local design_file="$KNOWLEDGE/design.md"
  local log_dir="$KNOWLEDGE/test-log"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local out_file="$log_dir/test_${timestamp}.md"

  [[ -f "$design_file" ]] || die "設計書が見つかりません: $design_file"

  log "テスタを起動します..."

  claude -p "$(load_prompt tester OUT_FILE="$out_file")" \
    --model claude-haiku-4-5-20251001 \
    --allowedTools "Write,Read,Glob,Grep,Bash"

  log "テストレポートを出力しました: $out_file"

  "$REPO_ROOT/scripts/rotate_logs.sh" test-log \
    || log "警告: test-log のローテーションに失敗しました（テスト結果には影響なし）"

  if grep -q '判定: 不合格' "$out_file" 2>/dev/null; then
    local critical_count
    critical_count=$(grep -c 'CRITICAL.*❌\|- 結果: ❌' "$out_file" 2>/dev/null) || critical_count="不明"
    log "テスト不合格（CRITICAL 失敗: ${critical_count}件）"
    return 1
  else
    log "テスト通過"
    return 0
  fi
}

# ── オーディ ──────────────────────────────────────────────────────────────────
# 入力: 実装コード + design.md + requirements.md + test-to-aud.md
# 出力: docs/knowledge/audit-log/audit_YYYYMMDD_HHMMSS.md
# 戻り値: 0=通過, 1=ループ継続（アーキに差し戻し）

run_auditor() {
  local design_file="$KNOWLEDGE/design.md"
  local log_dir="$KNOWLEDGE/audit-log"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local out_file="$log_dir/audit_${timestamp}.md"

  [[ -f "$design_file" ]] || die "設計書が見つかりません: $design_file"

  log "オーディを起動します..."

  claude -p "$(load_prompt auditor OUT_FILE="$out_file")" \
    --allowedTools "Write,Read,Glob,Grep,Bash"

  log "監査ログを出力しました: $out_file"

  "$REPO_ROOT/scripts/rotate_logs.sh" audit-log \
    || log "警告: audit-log のローテーションに失敗しました（監査結果には影響なし）"

  local high_count total_count
  high_count=$(grep -c '### \[HIGH-' "$out_file" 2>/dev/null) || high_count=0
  total_count=$(grep -c '### \[' "$out_file" 2>/dev/null) || total_count=0

  log "HIGH: ${high_count}件 / 合計: ${total_count}件"

  if [[ "$high_count" -eq 0 && "$total_count" -le 5 ]]; then
    log "監査通過"
    _append_backlog "$out_file"
    return 0
  else
    log "監査不通過（ループ継続）"
    return 1
  fi
}

# ── エントリーポイント ────────────────────────────────────────────────────────

require_claude

case "${1:-}" in
  architect) run_architect ;;
  engineer)  run_engineer ;;
  tester)    run_tester ;;
  auditor)   run_auditor ;;
  *)
    echo "Usage: $0 <architect|engineer|tester|auditor>"
    exit 1
    ;;
esac
