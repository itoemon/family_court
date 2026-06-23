#!/usr/bin/env bash
# Usage: set -a && source .env.test && set +a && ./scripts/setup-test-db.sh [--clean-cases] [--dry-run]
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
#   --clean-cases  初期化済みテスト DB の public.cases を全削除する（子テーブルは
#                  ON DELETE CASCADE で連鎖削除、profiles 等のユーザーデータは保持）。
#                  schema.sql / migrations の適用は行わない。E2E が書き残した cases の
#                  蓄積を掃除する用途。--dry-run と併用すると件数表示のみで削除しない。
#   --dry-run      適用対象と順序を表示するだけで実行しない
#   -h, --help     このヘルプを表示
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_SQL="$REPO_ROOT/supabase/schema.sql"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# 本番プロジェクト ref（誤爆防止のブロックリスト）
PROD_PROJECT_REF="nhcsshqcyprbitfctyio"

DRY_RUN=0
CLEAN_CASES=0

log() { echo "[setup-test-db.sh] $*"; }
die() { echo "[setup-test-db.sh] ERROR: $*" >&2; exit 1; }

# ── 引数 ──────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean-cases) CLEAN_CASES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,/^[^#]/{/^#/s/^# \?//p}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "不明な引数: $1（--clean-cases / --dry-run / -h, --help のみ対応）" ;;
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

# 適用順（applied.txt は .sql ではないため自然に除外される）。
# glob 展開はロケール順にソート済みで、ファイル名に空白等が入っても安全。
# nullglob により 0 件マッチ時はリテラル "*.sql" ではなく空配列になる。
shopt -s nullglob
MIGRATION_FILES=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob
[[ "${#MIGRATION_FILES[@]}" -gt 0 ]] || die "適用対象の migration が見つかりません: $MIGRATIONS_DIR/*.sql"

# ── Management API 経由で SQL を実行 ───────────────────────────────────────────
# 標準出力に応答 body を返す。HTTP 非 2xx もしくは応答に error message があれば die。
supabase_execute() {
  local sql="$1" label="$2"
  local payload resp http_code body msg
  payload="$(jq -n --arg q "$sql" '{query: $q}')"
  # -sS: 進捗は隠すがエラーは表示。curl 自体が非 0 終了（ネットワークエラー等）した
  # 場合は set -e に任せず明示的に die して原因を分かりやすくする。
  resp="$(curl -sS -w $'\n%{http_code}' -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload")" || die "[$label] API リクエストに失敗しました（ネットワーク到達性 / トークンを確認してください）。"
  http_code="$(tail -n1 <<<"$resp")"
  body="$(sed '$d' <<<"$resp")"
  if [[ "$http_code" != 2* ]] || echo "$body" | jq -e 'type=="object" and has("message")' >/dev/null 2>&1; then
    msg="$(echo "$body" | jq -r '.message // .' 2>/dev/null || echo "$body")"
    die "[$label] SQL 適用に失敗 (HTTP $http_code): $msg"
  fi
  echo "$body"
}

# ── --clean-cases: 初期化済みテスト DB の cases を全削除して早期終了 ─────────────
# schema.sql / migrations は当てない。子テーブル（arguments / verdicts / judge_messages
# / defense_messages / contradiction_warnings / guest_tokens）はすべて
# `cases(id) ON DELETE CASCADE` 参照のため、cases 削除で連鎖削除される。
# profiles（E2E ユーザー）は cases から参照される側なので無傷。
if [[ "$CLEAN_CASES" == 1 ]]; then
  # 初期化済み（cases テーブル存在）であることを確認。未初期化への誤爆を防ぐ。
  init="$(supabase_execute "select (to_regclass('public.cases') is not null) as ok;" "clean preflight")"
  [[ "$(echo "$init" | jq -r '.[0].ok // false')" == "true" ]] || \
    die "public.cases が存在しません。--clean-cases は初期化済みテスト DB 専用です（先に schema.sql 適用が必要）。"

  before="$(supabase_execute "select count(*)::int as n from public.cases;" "count cases")"
  n="$(echo "$before" | jq -r '.[0].n')"

  if [[ "$DRY_RUN" == 1 ]]; then
    log "対象プロジェクト: $PROJECT_REF"
    log "--dry-run: cases ${n} 件 + 連鎖する子レコードを削除します（実行はしません）。"
    exit 0
  fi

  log "対象プロジェクト: $PROJECT_REF"
  log "cases ${n} 件を削除中（子テーブルは ON DELETE CASCADE で連鎖削除）…"
  supabase_execute "delete from public.cases;" "delete cases" >/dev/null
  log "完了。cases ${n} 件 + 連鎖する子レコードを削除しました（profiles 等のユーザーデータは保持）。"
  exit 0
fi

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

# Management API 直 SQL で適用したスキーマ変更は PostgREST のスキーマキャッシュに
# 即時反映されない。新カラムを含む REST 経由の select が「column does not exist」と
# なるのを防ぐため、適用後にスキーマ再読込を明示通知する。
log "PostgREST スキーマキャッシュを再読込中（NOTIFY pgrst）…"
supabase_execute "NOTIFY pgrst, 'reload schema';" "reload schema" >/dev/null
log "  ✓ reload schema"

log "完了。schema.sql + ${#MIGRATION_FILES[@]} 件の migration を適用しました。"
log "後続手順（Storage バケット確認 / E2E ユーザー作成 / シークレット生成）は docs/operations/e2e-test-db.md を参照。"
