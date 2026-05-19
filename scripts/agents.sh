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

# 監査通過後、MEDIUM/LOW の未修正指摘を docs/backlog.md の「未対応」セクションに追記する
_append_backlog() {
  local audit_file="$1"
  local backlog="$REPO_ROOT/docs/backlog.md"
  local audit_basename
  audit_basename="$(basename "$audit_file")"

  [[ -f "$backlog" ]] || return 0  # backlog.md がなければスキップ

  local medium_low_count
  medium_low_count=$(grep -c '### \[MEDIUM-\|### \[LOW-' "$audit_file" 2>/dev/null) || medium_low_count=0
  [[ "$medium_low_count" -eq 0 ]] && return 0  # MEDIUM/LOW がなければスキップ

  log "未修正の MEDIUM/LOW 指摘を backlog.md に追記します..."

  # 「未対応」セクションの末尾（--- の直前）に追記
  local entries
  entries="$(grep -A6 '### \[MEDIUM-\|### \[LOW-' "$audit_file" | sed "s|$| (由来: $audit_basename)|")"

  # 「## 未対応」と「---」の間に挿入
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

  local backlog_content
  backlog_content="$(cat "$REPO_ROOT/docs/backlog.md" 2>/dev/null || echo '（バックログなし）')"

  claude -p "$(cat <<PROMPT
あなたはソフトウェアアーキテクトです（エージェント名: アーキ）。
以下の要件書・既存 ADR・バックログを読み、設計書を作成して $out_file に保存してください。

# キャラクター
- 慎重で丁寧。設計の「なぜ」を必ず書く
- 選択肢が複数あるときはトレードオフを示し、推奨を明記する
- 既存の ADR・バックログと一貫性を保つことを最優先にする
- 実装の都合より保守性・拡張性を重視する
- 曖昧な要件は設計書の「注意事項」に残し、ビルドに判断を丸投げしない


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

# バックログ（過去の監査で未修正の指摘。今回の設計に関連するものは反映してください）
$backlog_content

# 出力形式
以下の構成で $out_file に Markdown を書き込んでください。
前置き・後書きは不要。設計書の本文だけを書いてください。

---
# 設計書

## 概要

## 画面・API 設計

## データモデル変更

## 実装ステップ（ビルドへの指示）

## 注意事項・制約
---
PROMPT
)" --allowedTools "Write,Read"

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

# キャラクター
- 実直で誠実。設計書に忠実だが、明らかな誤記や矛盾は実装コメントに残す
- セキュリティを最優先。疑わしいコードは書かない
- コメントは最小限。コードと命名で意図を伝える
- 型エラー・lint エラーをゼロにしてからコミットする
- 設計書にない機能を勝手に追加しない


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
以下の実装差分・設計書・要件書を読み、監査レポートを $out_file に保存してください。

# キャラクター
- 厳格で公平。褒めない（良い点は総評でのみ一言触れる）
- 指摘は必ず具体的なファイル名・行番号とセットで書く
- 「なんとなく気になる」は書かない。証拠と影響範囲を示せる指摘のみ書く
- エンドユーザー視点を忘れない。技術的な問題がユーザーにどう影響するかを考える
- 重大度は HIGH / MEDIUM / LOW の3段階で判定する（CVSS・OWASP の考え方を参考に）


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
以下の形式で $out_file に Markdown を書き込んでください。前置き・後書きは不要。

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
)" --allowedTools "Write,Read,Glob,Grep"

  log "監査ログを出力しました: $out_file"

  # 通過判定（HIGH の件数と合計指摘数を grep で数える）
  # grep -c はマッチなしでも "0" を出力して exit 1 するため、|| を subshell の外に出す
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
  auditor)   run_auditor ;;
  *)
    echo "Usage: $0 <architect|engineer|auditor>"
    exit 1
    ;;
esac
