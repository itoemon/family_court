# バックログ

プロダクトの未対応タスクを蓄積するファイルである。
オーディの監査指摘・ダイチの機能要望・改善案をまとめて管理する。
リードがセッション開始時・PR マージ後にダイチへ内容を共有する。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映すること。

由来表記は監査レポートへの相対パスを記載する（複数の監査レポートで同じ ID が出るため、`(由来 …)` と組み合わせて項目を一意に識別する）。

---

## 未対応

### 機能（FEAT）

#### [FEAT-004] 法案 Hub（公開・インポート機能）

- **内容**:
  - 他ユーザーが作った法律を閲覧できる公開 Hub を設ける
  - オーナーは自分の法律を Hub に公開できる
  - 他ユーザーは公開法案を「自分がオーナーの新しい法律」としてインポートでき、自分のフレンド間で利用できる
- **優先度**: 低（FEAT-003 完成後）
- **依存**: FEAT-003, FEAT-002

---

### 運用・テスト基盤（OPS）

#### [OPS-001] E2E 実行基盤の運用見直し

- **背景**: パイプラインのテスタ段階で E2E（Playwright）を回す前提が、本環境（Ubuntu）で 2 点の課題を抱える。
  1. **node バージョン**: Next.js 16 は node ≥ 20.9.0 必須だが、volta デフォルトが node18 だったため dev サーバーが起動できず E2E が実施不可だった。`package.json` に `volta.node = 20.20.2` を pin して解消済み（PR で同梱）。ただし `claude -p` で起動するパイプライン各エージェントは volta-node18 を継承し直すため、**テスタエージェント内の `npm run dev` は依然 node18 になる**（リードが手動サニタイズ環境で node20 起動して回避した）。テスタが node20 で dev サーバーを起動できる恒久策が必要（例: tester.md にサニタイズ手順を明記、または claude の node pin 見直し）。
  2. **E2E のターゲット DB**: 現状 `.env.local` が**本番 Supabase** を指しており、laws/friends 系 spec が本番にテストデータを作りうる。テスト用 DB / staging 環境、またはシード&クリーンアップ戦略の検討が必要。
- **暫定運用**: 当面は従来どおり（リードが node20 でターゲット検証を手動実施、または既存の本番ターゲット運用）。本項目で恒久策を設計する。
- **優先度**: 中（パイプライン信頼性に影響）
- **由来**: 2026-05-29 LOW バッチ対応時に顕在化

---

### 監査由来の品質改善

#### [LOW-001] `package.json` の `name` フィールド変更が変更ログ未記載（`package.json:2`、`package-lock.json:4`）

**由来**: `docs/knowledge/audit-log/audit_20260526_152517.md`

- **内容**: `package-lock.json` の `name` フィールドが `"family_court"` から `"igiari"` へ変更されている。`package.json` の現在値も `"igiari"` である（2行目）。しかし eng-to-aud.md の「変更ファイル一覧」では `package.json` の変更理由を `@upstash/*` 依存追加のみと説明しており、`name` フィールドの変更への言及がない。意図的なプロジェクト名変更であれば問題ないが、本監査ではその意図を文書から確認できない。エンドユーザーへの直接影響はないものの、Vercel のプロジェクト名・CI 設定と乖離した場合にデプロイのトレーサビリティが失われる。
- **修正案**: 変更が意図的であれば eng-to-aud.md の変更ファイル一覧に `package.json — name フィールドを igiari へ変更` を追記する。意図的でない場合は `"name": "family_court"` に戻す。

---

#### [LOW-002] `@upstash/core-analytics` が本番依存ツリーに混入（`package-lock.json`）

**由来**: `docs/knowledge/audit-log/audit_20260526_152517.md`

- **内容**: `analytics: false` を明示設定しているにもかかわらず、`@upstash/ratelimit@2.0.8` の推移的依存として `@upstash/core-analytics@0.0.10` が `node_modules` に含まれる（`package-lock.json` に `node_modules/@upstash/core-analytics` エントリあり）。このパッケージがモジュール初期化時にアウトバウンド接続を行わないことをコードレベルでは確認できない。`ratelimit.limit(user.id)` は毎リクエストごとに `user.id`（UUID）を渡すため、万一 `analytics: false` が完全に機能していない場合、ユーザー識別子が Upstash のサードパーティサーバーへ送信されうる。本アプリは夫婦・家族の話し合いというプライバシー高感度なドメインであるため、ユーザー識別子の外部送信リスクは軽視できない。
- **修正案**: `@upstash/core-analytics@0.0.10` の GitHub リポジトリ（upstash/core-analytics）でソースを確認し、`analytics: false` 時にアウトバウンド接続が発生しないことを検証する。または `npm run build` 後に `grep -r "core-analytics" .next/server/` を実行し、analytics 呼び出しがサーバーバンドルに含まれないことを確認する。

---

### マネタイズ（MON）

#### [MON-001] クレジット制課金（1 クレジット = 1 ケース）

- **内容**:
  - ケース作成時にクレジットを 1 消費する課金モデル
  - BYOK（自分の API キーを持ち込む）ユーザーは無料
  - サブスクリプションプランも将来的に追加したい（月額でクレジット付与）
  - 目的: サービス側が負担する API 料金を賄う
- **優先度**: 中（ユーザーが増えてきたタイミングで実装）
- **備考**: Stripe 等の決済基盤が必要。BYOK 判定ロジックは既存の `validateApiKey` を流用できる。

---

#### [MON-002] 広告表示

- **内容**: ユーザー体験を阻害しない範囲での広告を表示する（Google AdSense 等を想定）
- **目的**: サーバー代（Vercel・Supabase）を賄う
- **優先度**: 低
- **備考**: 課金ユーザー（MON-001）には広告を非表示にするのが理想。

---

## 対応済み

| PR | 内容 |
|----|------|
| PR #12       | middleware の保護パス整備・Suspense 境界・logout エラー処理 |
| PR #13 (B-1) | `defendantId`（被告 UUID）を認証なし API レスポンスから除去 |
| PR #13 (B-2) | ログアウト失敗時のフラッシュ Cookie + ErrorBanner 実装 |
| PR #14 (C-1) | `verifyGuestToken` try-catch 保護（argument / defense / draft の 3 ファイル） |
| PR #14 (C-2) | `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（lib/guest-token.ts） |
| PR #14 (C-3) | プロンプトインジェクション対策（escapeXml + truncate(50)） |
| PR #14 (C-4) | profiles 重複クエリ削減・contradiction_warnings に .limit(100) |
| PR #14 (D-1) | `defense.ts` dialogHistory.content に truncate 適用・text-utils.ts に切り出し |
| PR #14 (D-2) | `defense/route.ts` 認証ユーザーパスを try-catch で保護 |
| PR #14 (D-3) | `clear-flash` Cookie 削除に httpOnly: true（確認済み） |
| PR #14 (D-4) | A-2 テスト env チェック（確認済み） |
| PR #14 (D-5) | `judge_messages` 空文字列挿入ガード × 3 箇所 |
| PR #14 (D-6) | ゲスト名 DB バリデーション 50 文字（確認済み） |
| PR #15 (E-1) | `defense.ts` generateDraft の defenseHistory に truncate 適用 |
| PR #15 (E-2) | `route.ts` PATCH 非 asGuest パスを try-catch で保護 |
| PR #15 (E-3) | `layout.tsx` `<main>` → `<div>`（確認済み・実装済み） |
| PR #15 (E-4) | `validateApiKey` エラー種別区別（AuthenticationError のみ false） |
| PR #15 (E-5) | `history/page.tsx` Supabase エラーログ（確認済み・実装済み） |
| PR #15 (E-6) | `middleware.ts` 保護パスをプレフィックスマッチに変更 |
| PR #16 (F-1) | HMAC ゲストトークンを nonce ベースに刷新（guest_tokens テーブル追加） |
| PR #17 (FEAT-001) | igiari リネーム（UI・メタデータ・README・package.json） |
| PR #17 (IMP-002)  | デザイン色調統一（brand-* パレット定義・indigo/rose → brand 置換） |
| PR #17 (コパ指摘) | 無効 ESLint ルール名削除・フッター著作権年を動的生成に変更 |
| PR #18 (LOW-001)  | `defense/draft/route.ts` の `createSessionClient()` を try-catch で保護 |
| PR #18 (LOW-002)  | `guest_tokens.token_hash` に UNIQUE INDEX 追加（migration） |
| PR #18 (MEDIUM-001) | プライマリボタンを brand-700/800 に変更（WCAG AA コントラスト対応） |
| PR #18 (IMP-001)  | 自動スクロールをメッセージ存在時のみ発火するよう修正 |
| PR #19 (FEAT-002 P1) | プロフィールアイコン設定・弁護人 AI カスタム指示 |
| PR #19 (MEDIUM-001) | avatars バケットに file_size_limit・allowed_mime_types を設定 |
| PR #19 (LOW-001) | avatar アップロード時の magic bytes 検証を実装（Content-Type 偽装対策） |
| PR #19 (LOW-002) | `defenseCustomInstruction` の型検証を追加（typeof !== "string" チェック） |
| PR #20 (FEAT-002 P2) | フレンド機能（リクエスト送信・承認/拒否・一覧・削除） |
| PR #20 (LOW-001) | `friend_requests` への `anon` GRANT を最初から付与せず最小権限を確立（由来: `docs/knowledge/archive/audit-log/audit_20260526_142833.md`） |
| PR #20 (LOW-002) | `POST /api/friends/requests` で FK 違反 (23503) を 400 で個別ハンドル（由来: `docs/knowledge/archive/audit-log/audit_20260526_142833.md`） |
| PR #21 (MEDIUM-001) | `/api/users/search` に Upstash Redis レートリミットを実装 |
| PR #22 (FEAT-003) | 法律作成機能（作成・招待・投票・退会・改定・所有権移譲） |
| PR #23 (BUG-001) | サインアップ時の確認メール未着を修正（Gmail SMTP・emailRedirectTo の明示化） |
| PR #24 (chore) | トークン消費の可視化（statusline.py・token_report.py）とログローテーション機構（rotate_logs.sh） |
| PR #25 (chore) | backlog の完了項目整理・由来重複の掃除 |
| PR #26 (MEDIUM-001) | Server Component の `law_*` 読み取りを `createAdminClient()` → `createSessionClient()`（RLS 二重防御）に切替・`laws` SELECT ポリシーを invitee 本人まで拡張（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
| PR #27 (LOW-001) | API 動的セグメントの UUID バリデーション追加（全 15 ルート）・`UUID_REGEX` を `lib/text-utils.ts` に共通化（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
| PR #27 (LOW-002) | `PendingInvitations.tsx` の fetch ステータス検査・失敗時エラー表示とリフレッシュ抑止（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
