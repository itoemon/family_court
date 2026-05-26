---
name: session-context
description: リードの直近セッションの要約。新しいチャットを開いたときに会話の文脈を引き継ぐために使う
metadata:
  type: project
---

# セッション引き継ぎ

新しいチャットを開いたら、リードはこのファイルを読んで前回の状況を把握する。
セッション終了時またはひと区切りついたタイミングで更新する。

---

## 最終更新: 2026-05-26（Stop フック自動更新 セッション 34 終了）

### 現在のブランチ・PR 状態

- ブランチ: `feature/20260526-155829`
- HEAD: `11e471e` — `fix(FEAT-003): InvitePanel を /api/friends ベースのローカルフィルタに変更`
- **直近マージ PR**:
  - PR #20: `feat(FEAT-002-p2)` フレンド機能 + LOW-001/002 修正 ✅
  - PR #21: `fix(MEDIUM-001)` `/api/users/search` にレートリミット追加 ✅
- **未コミット変更あり**: `docs/knowledge/design.md`（staged）、`arch-to-eng.md`・`task.md`・`session_context.md`（unstaged）

### 直近セッションでやったこと（2026-05-26 セッション 33-34）

- **FEAT-003（法律作成機能）実装が全 Step 完了・コミット済み**（`235d713`）
  - Step 1: `supabase/migrations/20260526000003_feat003_laws.sql`（5テーブル・RLS・インデックス）✅
  - Step 2: `lib/types.ts`（`Law`, `LawMember`, `LawInvitation`, `LawProposal`, `LawProposalVote` 等）✅
  - Step 3: `app/api/laws/`（9エンドポイント）✅
  - Step 4: `middleware.ts`（`/laws` 認証保護追加）✅
  - Step 5: `app/laws/`（`/laws`, `/laws/new`, `/laws/[id]` + 5 Client Components）✅
  - 追加: `lib/laws/consensus.ts`（合意チェック共通ロジック）✅
- **FEAT-003 バグ修正**（`11e471e`）: InvitePanel が `/api/users/search` を叩いていたため `/api/friends` ベースのローカルフィルタに変更（フレンド以外を招待できるバグを修正）
- ドキュメント一式更新済み（`design.md`, `task.md`, `arch-to-eng.md`, `eng-to-aud.md`）
- **テスト・監査はまだ実施していない**（オーディ未起動）

### FEAT-003 機能要件サマリー

- L-1: 法律作成（法律名 100 字・条文 2000 字、作成者がオーナー兼メンバー）
- L-2: メンバー招待（フレンドのみ、承認/拒否）
- L-3: 改定案提出・全メンバー合意で成立、同時 1 件制限、オーナーが取り下げ可
- L-4: オーナー権移譲
- L-5: 退会（オーナー以外自由、合意票も無効化）
- L-6: 法律削除（全メンバー合意）

### 次のアクション

1. **未コミット docs を整理してコミット**（`docs/knowledge/` の staged/unstaged 差分）
2. **テスタ → オーディ** の正規パイプラインを回す（推奨）、またはスキップして軽量 PR 作成
3. **PR 作成** → `main` へ
4. **マージ後**: 本番 DB への migration 適用
5. 次フィーチャー検討（`docs/backlog.md` 参照）

### 決定事項（引き継ぎ）

- FEAT-002（Phase 1 / Phase 2）・LOW-001/002・MEDIUM-001 すべて完了・マージ済み
- Upstash Redis は無料枠（1日 10,000 コマンド）で十分（env vars なし時は skip fallthrough）
- **現在フェーズ: FEAT-003（法律作成機能）— 実装・バグ修正コミット完了、テスト/監査待ち**

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
