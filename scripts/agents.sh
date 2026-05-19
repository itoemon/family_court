#!/usr/bin/env bash
# Usage: ./scripts/agents.sh <architect|engineer|auditor>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOWLEDGE="$REPO_ROOT/docs/knowledge"
DECISIONS="$REPO_ROOT/docs/decisions"

# ── ユーティリティ ────────────────────────────────────────────────────────────

log() { echo "[agents.sh] $*"; }
die() { echo "[agents.sh] ERROR: $*" >&2; exit 1; }

require_claude() {
  command -v claude &>/dev/null || die "'claude' CLI が見つかりません。インストールしてください。"
}

# ── アーキ ────────────────────────────────────────────────────────────────────
# 入力: docs/knowledge/requirements/
# 出力: docs/knowledge/design/design.md

run_architect() {
  local req_dir="$KNOWLEDGE/requirements"
  local out_file="$KNOWLEDGE/design/design.md"

  [[ -d "$req_dir" ]] || die "要件ディレクトリが見つかりません: $req_dir"
  ls "$req_dir"/*.md &>/dev/null || die "要件書 (*.md) が $req_dir に見つかりません"

  log "アーキを起動します..."

  local req_content
  req_content="$(cat "$req_dir"/*.md)"

  local adr_content
  adr_content="$(cat "$DECISIONS"/*.md 2>/dev/null || echo '（ADR なし）')"

  claude -p "$(cat <<PROMPT
あなたはソフトウェアアーキテクトです（エージェント名: アーキ）。
以下の要件書と既存 ADR を読み、設計書を作成してください。

# ディレクトリ権限
参照可能:
  - docs/knowledge/requirements/  （要件書）
  - docs/decisions/               （ADR）
書き込み可能:
  - docs/knowledge/design/        （設計書の出力先）
触れてはいけない:
  - app/, lib/, supabase/         （実装コード）
  - docs/knowledge/audit-log/     （監査ログ）
  - memory/                       （リードの個人メモ）

# 要件書
$req_content

# 既存 ADR（技術的制約として参照）
$adr_content

# 出力形式
以下の構成で Markdown を出力してください。
コードブロックや前置き・後書きは不要。設計書の本文だけを出力してください。

---
# 設計書

## 概要

## 画面・API 設計

## データモデル変更

## 実装ステップ（ビルドへの指示）

## 注意事項・制約
---
PROMPT
)" > "$out_file"

  log "設計書を出力しました: $out_file"
}

# ── ビルド ────────────────────────────────────────────────────────────────────
# 入力: docs/knowledge/design/design.md
# 出力: feature ブランチにコミット済みコード

run_engineer() {
  local design_file="$KNOWLEDGE/design/design.md"
  [[ -f "$design_file" ]] || die "設計書が見つかりません: $design_file"

  # feature ブランチ名を決める（タイムスタンプ付き）
  local branch="feature/$(date +%Y%m%d-%H%M%S)"
  git -C "$REPO_ROOT" checkout -b "$branch"
  log "ブランチを作成しました: $branch"

  local design_content
  design_content="$(cat "$design_file")"

  log "ビルドを起動します（ブランチ: $branch）..."

  # ビルドは Claude Code CLI の --allowedTools を使い、ファイル操作を許可する
  claude -p "$(cat <<PROMPT
あなたはシニアエンジニアです（エージェント名: ビルド）。
以下の設計書を読み、Next.js 14 App Router + TypeScript + Tailwind CSS + Supabase のコードを実装してください。

# ディレクトリ権限
参照可能:
  - docs/knowledge/design/        （設計書）
書き込み可能（feature ブランチのみ）:
  - app/                          （ページ・API Routes）
  - lib/                          （共有ロジック）
  - supabase/                     （DBスキーマ）
  - middleware.ts
触れてはいけない:
  - docs/                         （ドキュメント類）
  - memory/                       （リードの個人メモ）
  - main ブランチへの直接コミット（必ず feature ブランチを使う）

# 設計書
$design_content

# ルール
- 実装後、git add と git commit まで行ってください（push は不要）
- コミットメッセージは日本語で、feat: / fix: / chore: などのプレフィックスを付けてください
- 型エラー・lint エラーがないことを確認してください
- セキュリティ上の問題（XSS・SQLi・秘密情報のハードコード等）を絶対に混入させないでください
PROMPT
)" --allowedTools "Edit,Write,Bash,Read,Glob,Grep"

  log "実装完了（ブランチ: $branch）"
  echo "$branch"  # パイプライン側でブランチ名を受け取れるよう標準出力に出す
}

# ── オーディ ──────────────────────────────────────────────────────────────────
# 入力: 実装コード + design.md + requirements/
# 出力: docs/knowledge/audit-log/audit_YYYYMMDD_HHMMSS.md
# 戻り値: 0=通過, 1=ループ継続

run_auditor() {
  local design_file="$KNOWLEDGE/design/design.md"
  local req_dir="$KNOWLEDGE/requirements"
  local log_dir="$KNOWLEDGE/audit-log"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local out_file="$log_dir/audit_${timestamp}.md"

  [[ -f "$design_file" ]] || die "設計書が見つかりません: $design_file"
  [[ -d "$req_dir" ]] || die "要件ディレクトリが見つかりません: $req_dir"

  local design_content req_content
  design_content="$(cat "$design_file")"
  req_content="$(cat "$req_dir"/*.md)"

  log "オーディを起動します..."

  # 差分コード（最新コミットから main との差分）を取得
  local diff_content
  diff_content="$(git -C "$REPO_ROOT" diff main...HEAD 2>/dev/null || git -C "$REPO_ROOT" diff HEAD~1 HEAD)"

  claude -p "$(cat <<PROMPT
あなたはセキュリティ監査の専門家です（エージェント名: オーディ）。
以下の実装差分・設計書・要件書を読み、監査レポートを作成してください。

# ディレクトリ権限
参照可能:
  - app/, lib/, supabase/         （実装コード・読み取りのみ）
  - docs/knowledge/design/        （設計書）
  - docs/knowledge/requirements/  （要件書）
書き込み可能:
  - docs/knowledge/audit-log/     （監査ログの出力先）
触れてはいけない:
  - app/, lib/, supabase/         （実装コードへの書き込み）
  - docs/knowledge/design/        （設計書への書き込み）
  - memory/                       （リードの個人メモ）

# 実装差分
\`\`\`diff
$diff_content
\`\`\`

# 設計書
$design_content

# 要件書
$req_content

# 出力形式
以下の形式で Markdown を出力してください。前置き・後書きは不要。

---
# 監査レポート

## サマリー
- 指摘件数: HIGH N件 / MEDIUM N件 / LOW N件

## 指摘一覧

### [HIGH-001] タイトル（該当ファイル:行番号）
- **内容**: 問題の説明
- **修正案**: 具体的な修正方法

### [MEDIUM-001] ...

## 総評
---

# 判定基準
通過条件: HIGH が 0 件、かつ指摘総数が 5 件以下
PROMPT
)" > "$out_file"

  log "監査ログを出力しました: $out_file"

  # 通過判定（HIGH の件数と合計指摘数を grep で数える）
  local high_count total_count
  high_count=$(grep -c '^\### \[HIGH-' "$out_file" 2>/dev/null || echo 0)
  total_count=$(grep -c '^\### \[' "$out_file" 2>/dev/null || echo 0)

  log "HIGH: ${high_count}件 / 合計: ${total_count}件"

  if [[ "$high_count" -eq 0 && "$total_count" -le 5 ]]; then
    log "監査通過"
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
  auditor)   run_auditor ;;
  *)
    echo "Usage: $0 <architect|engineer|auditor>"
    exit 1
    ;;
esac
