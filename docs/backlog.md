# バックログ

プロダクトの未対応タスクを蓄積するファイルである。
オーディの監査指摘・ダイチの機能要望・改善案をまとめて管理する。
リードがセッション開始時・PR マージ後にダイチへ内容を共有する。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映すること。

---

## 未対応

### 機能（FEAT）

#### [FEAT-002] ユーザー機能の拡充

- **内容**:
  - アイコン設定（Supabase Storage にアップロード、プロフィール画面から変更）
  - 弁護人 AI のカスタム指示機能（プロンプトの一部をユーザーが上書きできる）
  - フレンド機能（ユーザー間のつながりを管理、後述の法律機能の基盤）
- **優先度**: 中
- **依存**: FEAT-004（フレンド機能は法律機能の前提となりうる）

### [MEDIUM-001] avatars バケットにバケットレベルのサイズ・MIME制限が未設定（supabase/migrations/20260526000001_feat002_phase1_profiles.sql:11-13） (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
- **内容**: `storage.buckets` への INSERT で `file_size_limit` と `allowed_mime_types` を指定していない。Supabase Storage の RLS ポリシーはオブジェクトの「誰がどのパスに書けるか」を制限するが、ファイルのサイズや種別は制限しない。認証済みユーザーが Supabase JS クライアントを直接使ってアップロードリクエストを送ると、API Route のバリデーション（2MB・jpeg/png/webp のみ）を迂回し、任意サイズ・任意形式のファイルを公開バケットに書き込める。`avatars` バケットは `public = true` のため、アップロードされたファイルは誰でも公開 URL でアクセスできる。設計書は「Storage には別途 RLS ポリシーを設定し、直接アクセスへの二重防御とする」と明記しているが、実装ではパス制限のみで種別・サイズの防御が機能していない。 (由来: audit_20260526_115705.md)
- **修正案**: `INSERT INTO storage.buckets` に `file_size_limit`（2097152 = 2MB）と `allowed_mime_types`（`['image/jpeg', 'image/png', 'image/webp']`）を追加する。 (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
  ```sql (由来: audit_20260526_115705.md)
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) (由来: audit_20260526_115705.md)
-- (由来: audit_20260526_115705.md)
### [LOW-001] MIME タイプの magic bytes 検証なし（app/api/profile/avatar/route.ts:31-32） (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
- **内容**: `file.type` はクライアントが multipart リクエストの `Content-Type` ヘッダーに設定した値をそのまま使う。悪意あるクライアントは実体が SVG（スクリプト埋め込み可）・HTML・任意バイナリのファイルに `Content-Type: image/jpeg` ヘッダーを付与してリクエストを送ることができ、MIME allowlist チェック（行 32）を通過してしまう。ただし Supabase Storage はアップロード時に指定した `contentType` でオブジェクトを配信するため、ブラウザは `Content-Type: image/jpeg` で受け取りスクリプトとして実行しない。現状の直接的な実行リスクは低いが、公開バケットに意図しないコンテンツが格納される可能性がある。 (由来: audit_20260526_115705.md)
- **修正案**: ファイル先頭バイト（magic bytes）でファイル種別を検証する。`arrayBuffer()` の最初の 12 バイトを読んで JPEG（`FF D8 FF`）・PNG（`89 50 4E 47`）・WebP（`52 49 46 46 … 57 45 42 50`）のシグネチャと照合し、不一致なら 400 を返す。MEDIUM-001 の bucket レベル `allowed_mime_types` 制限と組み合わせることで二重防御となる。 (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
--- (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
### [LOW-002] `defenseCustomInstruction` フィールドの型検証が未実施（app/api/profile/route.ts:33-34） (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
- **内容**: `req.json()` で取得した `defenseCustomInstruction` が文字列であることを検証していない。クライアントが `{"defenseCustomInstruction": 12345}` のように数値・配列・オブジェクト等を送ると、行 33 の `=== ""` チェックは通過せず（数値は `""` でない）、行 34 の `instruction.length` が `undefined` となる。`undefined > 200` は `false` のためバリデーションをスキップし、非文字列値がそのまま `updates.defense_custom_instruction` にセットされる。PostgreSQL は数値等を text に coerce するため DB レベルでは大きな問題にならないが、型安全な境界での検証が欠如しており、DB の CHECK 制約頼みになっている。エンドユーザーへの影響は軽微だが、API のロバスト性が低い。 (由来: audit_20260526_115705.md)
- **修正案**: `defenseCustomInstruction !== undefined` の分岐内先頭で型チェックを追加する。 (由来: audit_20260526_115705.md)
 (由来: audit_20260526_115705.md)
  ```typescript (由来: audit_20260526_115705.md)
  if (typeof defenseCustomInstruction !== "string" && defenseCustomInstruction !== null) { (由来: audit_20260526_115705.md)

---

#### [FEAT-003] 法律作成機能

オリジナルのルールセット（法律）を作成・管理できる機能。

- **内容**:
  - オーナーが遵守すべきオリジナルルールを作成できる
  - オーナーが新たな参加者を招待でき、参加者間でルールが施行される
  - 参加者は改定案を提出でき、全参加者の合意で改定される
  - オーナー権は他の参加者に移譲できる
  - オーナー以外は自由に退会できる
  - オーナーは全参加者の合意を得て法律を削除できる
- **優先度**: 中〜高（サービスの差別化軸）
- **備考**: DB 設計が複雑（法律・参加者・改定案・合意状態のテーブル群が必要）。アーキへの要件定義を先行させること。
- **依存**: FEAT-002（フレンド機能）

---

#### [FEAT-004] 法案 Hub（公開・インポート機能）

- **内容**:
  - 他ユーザーが作った法律を閲覧できる公開 Hub を設ける
  - オーナーは自分の法律を Hub に公開できる
  - 他ユーザーは公開法案を「自分がオーナーの新しい法律」としてインポートでき、自分のフレンド間で利用できる
- **優先度**: 低（FEAT-003 完成後）
- **依存**: FEAT-003, FEAT-002

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

### 改善（IMP）

#### [IMP-001] チャットページ以外での自動スクロール停止

- **内容**: ページ読み込み時に最下部へ自動スクロールする挙動が、チャットページ（`/case/[id]`）以外でも発生している。チャットページのみに限定する。
- **優先度**: 高（現在進行形のバグ）
- **推定原因**: `useEffect` + `scrollIntoView` や `scroll-smooth` がグローバルに効いている可能性。

---

### MEDIUM（オーディ監査指摘）

#### [MEDIUM-001] `bg-brand-500 text-white` — WCAG AA コントラスト比不足（全プライマリボタン）

- **該当ファイル・行番号**:
  - `app/page.tsx`:125
  - `app/auth/login/page.tsx`:79
  - `app/auth/signup/page.tsx`:117
  - `app/case/[id]/page.tsx`:277, 295, 325, 433, 508
- **内容**: amber-500 + white のコントラスト比は WCAG AA（4.5:1）未達。
- **修正案**: `bg-brand-500` → `bg-brand-700` に変更する（amber-700 は十分なコントラスト比を持つ）。

---

---

## 対応済み

| PR | 内容 |
|----|------|
| PR #16 (F-1) | HMAC ゲストトークンを nonce ベースに刷新（guest_tokens テーブル追加） |
| PR #15 (E-1) | `defense.ts` generateDraft の defenseHistory に truncate 適用 |
| PR #15 (E-2) | `route.ts` PATCH 非 asGuest パスを try-catch で保護 |
| PR #15 (E-3) | `layout.tsx` `<main>` → `<div>`（確認済み・実装済み） |
| PR #15 (E-4) | `validateApiKey` エラー種別区別（AuthenticationError のみ false） |
| PR #15 (E-5) | `history/page.tsx` Supabase エラーログ（確認済み・実装済み） |
| PR #15 (E-6) | `middleware.ts` 保護パスをプレフィックスマッチに変更 |
| PR #14 (D-1) | `defense.ts` dialogHistory.content に truncate 適用・text-utils.ts に切り出し |
| PR #14 (D-2) | `defense/route.ts` 認証ユーザーパスを try-catch で保護 |
| PR #14 (D-5) | `judge_messages` 空文字列挿入ガード × 3箇所 |
| PR #14 (C-1) | `verifyGuestToken` try-catch 保護（argument / defense / draft の 3ファイル） |
| PR #14 (C-2) | `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（lib/guest-token.ts） |
| PR #14 (C-3) | プロンプトインジェクション対策（escapeXml + truncate(50)） |
| PR #14 (C-4) | profiles 重複クエリ削減・contradiction_warnings に .limit(100) |
| PR #14 (D-3) | `clear-flash` Cookie 削除に httpOnly: true（確認済み） |
| PR #14 (D-4) | A-2 テスト env チェック（確認済み） |
| PR #14 (D-6) | ゲスト名 DB バリデーション 50文字（確認済み） |
| PR #13 (B-1) | `defendantId`（被告 UUID）を認証なし API レスポンスから除去 |
| PR #13 (B-2) | ログアウト失敗時のフラッシュ Cookie + ErrorBanner 実装 |
| PR #12       | middleware の保護パス整備・Suspense 境界・logout エラー処理 |
| PR #17 (FEAT-001) | igiari リネーム（UI・メタデータ・README・package.json） |
| PR #17 (IMP-002)  | デザイン色調統一（brand-* パレット定義・indigo/rose → brand 置換） |
| PR #18 (LOW-001)  | `defense/draft/route.ts` の `createSessionClient()` を try-catch で保護 |
| PR #18 (LOW-002)  | `guest_tokens.token_hash` に UNIQUE INDEX 追加（migration） |
| PR #18 (MEDIUM-001) | プライマリボタンを brand-700/800 に変更（WCAG AA コントラスト対応） |
| PR #18 (IMP-001)  | 自動スクロールをメッセージ存在時のみ発火するよう修正 |
| PR #17 (コパ指摘) | 無効 ESLint ルール名削除・フッター著作権年を動的生成に変更 |
