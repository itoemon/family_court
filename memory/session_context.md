---
name: session-context
description: リードの直近セッションの要約。新しいチャットを開いたときに会話の文脈を引き継ぐために使う
metadata:
  type: project
---

# セッション引き継ぎ

新しいチャットを開いたら、リードはこのファイルを読んで前回の状況を把握する。
**更新タイミング**: ダイチが「セッションを乗り換える」「session_context を更新して」と明示したときのみ ([[feedback-session-context]] 参照)。

---

## 最終更新: 2026-05-28（環境刷新・トークン消費対策・PR #23/#24 整備）

### 現在のブランチ・PR 状態

- 現ブランチ: `chore/log-rotation-tooling`（clean、push 済み）
- main HEAD: `e0ba32f docs(test): FEAT-003 テストログを追加（L03/L04 修正過程）`

#### オープン PR

- **PR #23** (`feature/20260527-153557`) — fix(BUG-001): サインアップ時の確認メール未着を修正
  - コパレビュー 7 件 → 全対応コミット `332df1d` push 済み
  - ダイチ確認: 「コパからレビュー来た、修正点なさそう」 → **マージ可能**
- **PR #24** (`chore/log-rotation-tooling`) — chore: トークン消費の可視化とログローテーション機構
  - 本日新規作成、コパレビュー待ち
  - コミット: `5b8c382` tooling 追加 / `54cd609` 既存ログ退避

### 直近セッションでやったこと（2026-05-27〜28）

開発環境の刷新とトークン消費対策が主軸。

1. **環境移行**: VSCode リモートトンネル → Ubuntu + tailscale + termius (SSH from スマホ) + tmux
2. **session_context.md 更新ポリシー変更**: 毎ターン自動更新 → ダイチ明示時のみ。トークン消費が激しく Max プランでも上限に当たるため。tmux でセッション保持されるので常時最新化は不要
3. **トークン消費の可視化**:
   - `~/.claude/statusline.py` 新規 — セッション中の消費・コンテキスト % を常時表示（60% 超で黄、80% 超で赤）
   - `~/.claude/settings.json` に statusLine 設定
   - `scripts/token_report.py` 新規 — 日別/セッション別/モデル別/ブランチ別の集計。source アダプタ構造で将来 Codex CLI 追加可能
4. **ログローテーション機構**:
   - `scripts/rotate_logs.sh` 新規 — audit-log/test-log を直近 KEEP=3 件のみアクティブに保つ
   - `scripts/agents.sh` のテスタ/オーディ実行直後に自動呼び出し
   - 既存累積ログ 43 件（audit 19 + test 24）を `docs/knowledge/archive/` へ退避 → アクティブ docs サイズ 1/4 以下に（約 84k トークン削減）
5. **承認スキップ**: `.claude/settings.local.json` に `permissions.defaultMode: "bypassPermissions"` を設定（このプロジェクト内限定・**次回 Claude Code 起動時から有効**）
6. **gh CLI セットアップ**: Ubuntu に `apt install gh` でインストール（v2.45.0）、`gh auth login` で `itoemon` 認証済み（HTTPS）
7. **PR #23 コパレビュー対応 7 件**:
   - signup/page.tsx: `emailRedirectTo` を `new URL('/auth/callback', siteUrl).toString()` で組み立て。`NEXT_PUBLIC_SITE_URL` 未設定時はサインアップ中断 + エラー表示
   - laws.spec.ts L03/L04: `waitForTimeout(1_000)` → `expect(acceptBtn).toBeHidden({ timeout: 5_000 })`
   - BUG-001 設計書: Resend 前提 → Gmail SMTP 前提に書き換え、誤字「该当」→「該当」
   - PR 説明にスコープ追記（FEAT-003 関連の同梱を明記、次回は分割と宣言）
8. **PR #24 作成**: ローテーション/トークン視覚化を別 PR 化

### 次のアクション（優先順）

1. **PR #23 を main へマージ**（コパ再レビュー OK 確認済み、ダイチ判断でマージ実行）
2. **PR #24 のコパレビュー対応**（来たら）
3. **PR #24 を main へマージ**
4. （任意・トークン対策の続き）session_context.md の累積セクションを `memory/decisions.md` 等に切り出して圧縮
5. （任意）`design.md` (20KB) + `design_defense_ai.md` (19KB) を機能別に分割
6. （任意）`backlog.md` の完了項目掃除

### 覚えておくべき判断・経緯

- guest_tokens テーブルは RLS 有効だが intentionally ポリシーなし（Service Role のみアクセス）
- `expires_at` はアプリ側で ISO 文字列計算（Supabase JS Client の `interval` 非対応のため）
- ゲスト参加 API でのトークン発行は必ず cases UPDATE より先に行う（逆順だとロック残存バグが再発）
- middleware の `/case` 保護は `/case/new` のみに限定（ゲスト参加フロー保護のため）
- E-6 の `/` は完全一致のみ（`/api/...` を誤って保護しないよう注意）
- 被告ロール色（`rose-*`）・エラー（`rose-*`）・弁護人AI色（`teal-*`）を維持
- `brand-500` は使わない（WCAG AA 非対応）。プライマリは `brand-700/800` に統一済み
- `avatars` バケット制限は migration で設定済み（magic bytes 検証は API Route 側でも実施）
- アバター削除は magic bytes 検証より先に実行する（URL に `?t=` キャッシュバスターを含めない）
- `search_users` 関数は `SECURITY DEFINER` で定義（`auth.users` JOIN のため）
- `friend_requests` の UNIQUE INDEX は `(LEAST(a,b), GREATEST(a,b))` で双方向重複をブロック
- 拒否（rejected）はレコード削除で処理（再送を許容するため）
- Upstash レートリミットは env vars なし時は `skip`（制限なし）で fallthrough する設計
- FEAT-003 の法律 API では退会処理は「投票削除 → メンバー削除 → 合意チェック」の順序を厳守
- InvitePanel は `/api/friends` で取得した一覧をローカルフィルタして招待済みを除外する設計（`/api/users/search` は使わない）
- 招待承認 UI は `/laws/[id]/page.tsx` の非メンバー分岐内に加え、`/laws/page.tsx` にも pending 招待セクションを設置
- **SMTP は Gmail SMTP を採用**（500 通/日制限、Google アプリパスワード使用）。設計書 `docs/knowledge/arch/BUG-001-email-confirm.md` 参照
- **サインアップの `emailRedirectTo`** は `new URL('/auth/callback', NEXT_PUBLIC_SITE_URL).toString()` で組み立て。SITE_URL 未設定時はサインアップ中断 + エラー表示（オープンリダイレクト回避のため `window.location.origin` フォールバックは採用しない）
- **`gh pr edit` は古い projects classic API で失敗**するため、PR body 更新は `gh api -X PATCH /repos/itoemon/family_court/pulls/N -f body="$(cat body.md)"` で実施
- **Claude Code Bash ツールは毎回独立シェルで起動**するため、別ペインで `apt install` したコマンドは即時 PATH 経由で利用可能（セッション再起動不要）
- **`.claude/settings.local.json` の設定は次回 Claude Code 起動時から有効**（動的リロードなし）
- **エージェント定義（`docs/agents/*.md`）は audit-log/test-log に触らない設計**なので、archive 退避してもエージェント動作には影響しない

### 環境・ツール状態（2026-05-28 時点）

- OS: Ubuntu（tailscale + termius SSH from スマホ + tmux でセッション保持）
- gh CLI: v2.45.0 インストール済み・`itoemon` 認証済み（HTTPS）
- Claude Code: `~/.claude/settings.json` に statusLine 設定済み（次回起動時から表示）
- プロジェクト承認スキップ: `.claude/settings.local.json`（gitignore 済み、次回起動時から有効）
- 過去セッションログ: VSCode 環境のものは未引き継ぎ、Ubuntu には今日以降のみ。`token_report.py` の集計対象は移行後のみ

### マージ済み PR（累計）

- PR #12: セキュリティ MEDIUM 3件・パフォーマンス MEDIUM 2件
- PR #13: B-1（UUID 露出防止）・B-2（ログアウトエラー通知）
- PR #14: D-1・D-2・D-5 セキュリティ修正 + 設計書更新
- PR #15: E-1・E-2・E-4・E-6 LOW 品質修正
- PR #16: F-1 HMAC ゲストトークン nonce ベース刷新
- PR #17: FEAT-001 igiari リネーム + IMP-002 色調統一（コパ指摘対応込み）
- PR #18: LOW-001/002 + MEDIUM-001 + IMP-001 品質・アクセシビリティ修正
- PR #19: FEAT-002-p1 プロフィールアイコン + 弁護人AIカスタム指示 ✅ 本番 DB 適用済み
- PR #20: FEAT-002-p2 フレンド機能 + LOW-001/002 修正 ✅
- PR #21: MEDIUM-001 `/api/users/search` レートリミット（Upstash Redis）✅
- PR #22: FEAT-003 法律作成機能 ✅
