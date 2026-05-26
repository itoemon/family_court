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

## 最終更新: 2026-05-26（FEAT-002-p1 PR #19 コパ指摘対応完了、マージ待ち）

### 現在のブランチ・PR 状態

- ブランチ: `feature/20260526-114703`
- **PR #19 コパ指摘5件対応完了、ダイチによるマージ承認待ち**
- 最新コミット: `ab45555` fix(review): コパ指摘5件を修正
- 未コミットファイル（docs系）: `docs/backlog.md`, `docs/knowledge/design.md`, `docs/knowledge/handoff/arch-to-eng.md`, `docs/knowledge/task.md`, `docs/knowledge/audit-log/audit_20260526_115705.md`（untracked）
  → PR マージ後にまとめてコミット予定

### 直近セッションでやったこと（2026-05-26）

- **FEAT-002 Phase 1 をビルドが実装**（`80d6a91`）
  - `app/api/profile/avatar/route.ts` 新規追加（アイコンアップロード API）
  - `app/api/profile/route.ts` 拡張（カスタムAI指示の CRUD）
  - `app/profile/page.tsx` 大幅拡張（アイコン設定 UI + カスタム指示入力 UI）
  - `supabase/migrations/20260526000001_feat002_phase1_profiles.sql` 追加
  - `lib/defense.ts` / `lib/types.ts` 更新（カスタム指示をプロンプトに注入）
- **オーディ（監査）実行** → ✅ 通過（HIGH 0件 / MEDIUM 1件 / LOW 2件）
- **オーディ指摘 3 件をビルドが修正**（`b70e17a`）
  - MEDIUM-001: `avatars` バケットに `file_size_limit` / `allowed_mime_types` を migration で設定
  - LOW-001: magic bytes 検証を API Route に追加
  - LOW-002: `defenseCustomInstruction` の型チェック（非文字列ガード）追加
- **PR #19 作成・投入**（FEAT-002-p1 全体、オーディ修正込み）
- **コパ指摘 5 件をビルドが修正**（`ab45555`）
  - 旧アバターファイル削除を magic bytes 検証より先に実行（順序修正 + URL から `?t=` パラメータ除去）
  - `as AllowedMime` の型安全性改善（`readonly string[]` で narrowing 後にキャスト）
  - `search` 未指定の意図をコメントで明示（キャッシュバスター用）
  - 認証情報ハードコードを環境変数化（`E2E_TEST_EMAIL_A` / `E2E_TEST_PASSWORD_A`）+ `beforeEach` スキップ制御
  - `schema.sql` / `applied.txt` に追記

### 次のアクション

1. **ダイチが PR #19 をマージ承認・実行**（コパ全指摘対応済み）
2. **マージ後に Supabase migration 適用**（`supabase db push` or ダッシュボード）— ダイチ側で対応
3. **マージ後に残ドキュメントをコミット**（未コミット docs 系 + 監査ログ）
4. **FEAT-002 Phase 2（フレンド機能）**は上記マージ後に別 PR で進める

### その後のロードマップ

1. **FEAT-002**: ユーザー機能拡充（フレンド機能 = Phase 2） — M
2. **FEAT-003**: 法律作成機能（DB 設計先行） — XL
3. **FEAT-004**: 法案 Hub（FEAT-003 完成後） — L
4. **MON-001/002**: クレジット制課金・広告表示 — 低優先度

### 覚えておくべき判断・経緯

- guest_tokens テーブルは RLS 有効だが intentionally ポリシーなし（Service Role のみアクセス）
- `expires_at` はアプリ側で ISO 文字列計算（Supabase JS Client の `interval` 非対応のため）
- ゲスト参加 API でのトークン発行は必ず cases UPDATE より先に行う（逆順だとロック残存バグが再発）
- middleware の `/case` 保護は `/case/new` のみに限定（ゲスト参加フロー保護のため）
- E-6 の `/` は完全一致のみ（`/api/...` を誤って保護しないよう注意）
- 維持: 被告ロール色（`rose-*`）・エラー（`rose-*`）・弁護人AI色（`teal-*`）
- `brand-500` は使わない（WCAG AA 非対応）。プライマリは `brand-700/800` に統一済み
- `avatars` バケット制限は migration で設定済み（magic bytes 検証は API Route 側でも実施）
- アバター削除は magic bytes 検証より先に実行する（URL に `?t=` キャッシュバスターを含めない）

### マージ済み PR（累計）

- PR #12: セキュリティ MEDIUM 3件・パフォーマンス MEDIUM 2件
- PR #13: B-1（UUID 露出防止）・B-2（ログアウトエラー通知）
- PR #14: D-1・D-2・D-5 セキュリティ修正 + 設計書更新
- PR #15: E-1・E-2・E-4・E-6 LOW 品質修正
- PR #16: F-1 HMAC ゲストトークン nonce ベース刷新
- PR #17: FEAT-001 igiari リネーム + IMP-002 色調統一（コパ指摘対応込み）
- PR #18: LOW-001/002 + MEDIUM-001 + IMP-001 品質・アクセシビリティ修正
- PR #19: FEAT-002-p1 プロフィールアイコン + 弁護人AIカスタム指示（マージ待ち）
