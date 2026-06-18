#!/usr/bin/env bash
# Usage: set -a && source .env.test && set +a && ./scripts/setup-test-db.sh [--dry-run]
#
# テスト用 Supabase プロジェクトに supabase/schema.sql → supabase/migrations/*.sql を
# ファイル名昇順で一括適用する。OPS-002 で対象 migration を冪等化したため、
# 「schema.sql -> migrations 全実行」が二重定義エラー (42710 / duplicate column) なく
# 完走する前提で自動化したものである。
#
# 想定: まっさらな（空の）テストプロジェクトに対して 1 度実行する。
# 既に初期化済みの DB に対しては schema.sql が CREATE TABLE で停止するため、
# preflight で検出して拒否する。再初期化が必要な場合は Supabase 側で public
# スキーマをリセットするか、新しいプロジェクトを作り直してから実行すること。
#
# 必須 env: SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF（.env.test を source する）
# 安全装置: 本番プロジェクト ref に対しては実行を拒否する。
#
# Options:
#   --dry-run   適用対象と順序を表示するだけで実行しない
#   -h, --help  このヘルプを表示
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_SQL="$REPO_ROOT/supabase/schema.sql"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# 本番プロジェクト ref（誤爆防止のブロックリスト）
PROD_PROJECT_REF="nhcsshqcyprbitfctyio"

DRY_RUN=0

log() { echo "[setup-test-db.sh] $*"; }
die() { echo "[setup-test-db.sh] ERROR: $*" >&2; exit 1; }

# ── 引数 ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "不明な引数: $1（--dry-run / --help のみ対応）" ;;
  esac
done

# ── 依存・必須 env ─────────────────────────────────────────────────────────────
command -v jq   &>/dev/null || die "'jq' が見つかりません。"
command -v curl &>/dev/null || die "'curl' が見つかりません。"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
[[ -n "$TOKEN" ]]       || die "SUPABASE_ACCESS_TOKEN が未設定。'set -a && source .env.test && set +a' してから実行してください。"
[[ -n "$PROJECT_REF" ]] || die "SUPABASE_PROJECT_REF が未設定。'set -a && source .env.test && set +a' してから実行してください。"

# ── 本番ブロック ───────────────────────────────────────────────────────────────
[[ "$PROJECT_REF" == "$PROD_PROJECT_REF" ]] && \
  die "対象が本番プロジェクト ($PROD_PROJECT_REF) です。テスト DB セットアップを本番に流すことはできません。"

[[ -f "$SCHEMA_SQL" ]]     || die "schema.sql が見つかりません: $SCHEMA_SQL"
[[ -d "$MIGRATIONS_DIR" ]] || die "migrations ディレクトリが見つかりません: $MIGRATIONS_DIR"

# 適用順（applied.txt は .sql ではないため自然に除外される）
mapfile -t MIGRATION_FILES < <(ls -1 "$MIGRATIONS_DIR"/*.sql | sort)
[[ "${#MIGRATION_FILES[@]}" -gt 0 ]] || die "適用対象の migration が見つかりません。"

# ── Management API 経由で SQL を実行 ───────────────────────────────────────────
# 標準出力に応答 body を返す。HTTP 非 2xx もしくは応答に error message があれば die。
supabase_execute() {
  local sql="$1" label="$2"
  local payload resp http_code body msg
  payload="$(jq -n --arg q "$sql" '{query: $q}')"
  resp="$(curl -s -w $'\n%{http_code}' -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload")"
  http_code="$(tail -n1 <<<"$resp")"
  body="$(sed '$d' <<<"$resp")"
  if [[ "$http_code" != 2* ]] || echo "$body" | jq -e 'type=="object" and has("message")' >/dev/null 2>&1; then
    msg="$(echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body")"
    die "[$label] SQL 適用に失敗 (HTTP $http_code): $msg"
  fi
  echo "$body"
}

# ── 適用計画の表示 ─────────────────────────────────────────────────────────────
log "対象プロジェクト: $PROJECT_REF"
log "適用順:"
log "  schema.sql"
for f in "${MIGRATION_FILES[@]}"; do log "  migrations/$(basename "$f")"; done

if [[ "$DRY_RUN" == 1 ]]; then
  log "--dry-run のため実行しません。"
  exit 0
fi

# ── 既初期化チェック（schema.sql は冪等でないため空 DB 前提）─────────────────────
log "対象 DB の初期化状態を確認中…"
preflight="$(supabase_execute "select (to_regclass('public.profiles') is not null) as initialized;" "preflight")"
if [[ "$(echo "$preflight" | jq -r '.[0].initialized // false')" == "true" ]]; then
  die "対象 DB は既に初期化済み（public.profiles が存在）。schema.sql は再実行できません。空のテストプロジェクトに対して実行するか、Supabase 側で public スキーマをリセットしてから再実行してください。"
fi

# ── 適用 ───────────────────────────────────────────────────────────────────────
log "schema.sql を適用中…"
supabase_execute "$(cat "$SCHEMA_SQL")" "schema.sql" >/dev/null
log "  ✓ schema.sql"

for f in "${MIGRATION_FILES[@]}"; do
  name="$(basename "$f")"
  log "migration を適用中: $name"
  supabase_execute "$(cat "$f")" "$name" >/dev/null
  log "  ✓ $name"
done

log "完了。schema.sql + ${#MIGRATION_FILES[@]} 件の migration を適用しました。"
log "後続手順（Storage バケット確認 / E2E ユーザー作成 / シークレット生成）は docs/operations/e2e-test-db.md を参照。"
