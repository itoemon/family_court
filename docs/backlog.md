# バックログ

プロダクトの未対応タスクを蓄積するファイルである。
オーディの監査指摘・ダイチの機能要望・改善案をまとめて管理する。
リードがセッション開始時・PR マージ後にダイチへ内容を共有する。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映すること。

---

## 未対応

### 機能（FEAT）

#### [FEAT-002 Phase 2] フレンド機能

- **内容**:
  - フレンドリクエスト送信（メアドまたは表示名で検索）
  - リクエスト承認 / 拒否
  - フレンド一覧表示
  - フレンド削除
- **優先度**: 中（FEAT-003 の前提）
- **備考**: `friend_requests` テーブル 1 枚で実現できる見込み。

### [MEDIUM-001] 検索エンドポイントに rate limiting がなく display_name を前方一致で全列挙できる（app/api/users/search/route.ts:4-26） (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
- **内容**: `GET /api/users/search?q=` は認証済みユーザーであれば制限なく呼び出せる。`search_users` 関数は `display_name ILIKE query || '%'` で前方一致検索を行い、最大 20 件を返す。攻撃者は `q=a`, `q=b`, ..., `q=z`, `q=aa`, ... と網羅的にリクエストを送ることで、全登録ユーザーの `display_name` を体系的に列挙できる。`id` と `avatar_url` も一緒に返されるため、そのまま FEAT-003 でのなりすましリクエストの下調べに利用できる。メール検索は完全一致のためリスクは低いが、display_name の前方一致は実質的にユーザーディレクトリとして機能する。   (由来: audit_20260526_142833.md)
- **エンドユーザーへの影響**: 他のユーザーに知られたくない表示名が第三者に取得され、社会工学的攻撃（フィッシングなど）に利用される可能性がある。   (由来: audit_20260526_142833.md)
- **修正案**: Next.js Middleware またはエッジ関数で IP または `user.id` 単位のレートリミットを設ける（例: 1分間に30リクエストまで）。短期的には `q` の最小文字数を設計書の「1文字」から「2〜3文字」に引き上げることで列挙コストを大きく上げられる。Upstash Redis + `@upstash/ratelimit` の組み合わせが Vercel 環境での定番実装。 (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
--- (由来: audit_20260526_142833.md)
-- (由来: audit_20260526_142833.md)
### [LOW-001] `anon` ロールへの不要な SELECT 権限付与（supabase/migrations/20260526000002_feat002_phase2_friends.sql:29） (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
- **内容**: `GRANT SELECT ON public.friend_requests TO anon;` により、未認証のブラウザクライアント（anon キー）も `friend_requests` テーブルに対して SELECT 権限を持つ。現時点では RLS ポリシー `friend_requests_select_own` が `USING (sender_id = auth.uid() OR receiver_id = auth.uid())` で制御しており、anon リクエストでは `auth.uid()` が NULL を返すため実際の行は一切返らない。機能上の問題はないが、最小権限の原則に反する。将来誰かが RLS ポリシーを変更・削除した場合（migration ミス、Supabase ダッシュボード操作など）、フレンド関係の全データが未認証ユーザーに公開されるリスクがある。   (由来: audit_20260526_142833.md)
- **エンドユーザーへの影響**: 上記の状態変化が起きた場合、全ユーザーのフレンド関係（誰と誰がつながっているか）が漏洩する。   (由来: audit_20260526_142833.md)
- **修正案**: `GRANT SELECT ON public.friend_requests TO anon;` の行を削除する。`anon` ロールは直接クライアントからの読み取りに使われるが、`friend_requests` へのアクセスはすべて API Route（service_role）経由で行われるため、anon への GRANT は不要である。 (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
--- (由来: audit_20260526_142833.md)
-- (由来: audit_20260526_142833.md)
### [LOW-002] 存在しない receiver_id に対する FK 違反（23503）が未処理で 500 を返す（app/api/friends/requests/route.ts:102-107） (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
- **内容**: `POST /api/friends/requests` は `receiver_id` の UUID v4 形式を正規表現で検証している（line 72）が、その UUID が `profiles.id` に存在するかどうかは確認しない。存在しない UUID を `receiver_id` として送信した場合、`friend_requests.receiver_id` の外部キー制約（`REFERENCES profiles(id)`）が PostgreSQL エラーコード 23503 を返す。コードは `23505`（重複）のみ個別ハンドルしており（line 103）、23503 はライン 106-107 の汎用 500 分岐に落ちる。レスポンス本文は `"リクエストの送信に失敗しました"` となりエラーコードを露出しないが、ステータスコードが 500（サーバー障害）になることは誤りであり、適切な 400（クライアント入力エラー）と区別できない。   (由来: audit_20260526_142833.md)
- **エンドユーザーへの影響**: フロントエンドは 5xx をサーバー側の障害として扱うため、ユーザーへの誤ったエラーメッセージ表示や不要なリトライが発生する可能性がある。ただし存在しない UUID を UI から送る経路は通常ないため、現実の発火は限定的。   (由来: audit_20260526_142833.md)
- **修正案**: `insertError.code === "23503"` を個別ハンドルして 400 または 404 を返す。 (由来: audit_20260526_142833.md)
 (由来: audit_20260526_142833.md)
  ```typescript (由来: audit_20260526_142833.md)

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
- **依存**: FEAT-002 Phase 2（フレンド機能）

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
| PR #19 (FEAT-002 Phase 1) | プロフィールアイコン設定・弁護人 AI カスタム指示 |
| PR #19 (MEDIUM-001) | avatars バケットに file_size_limit・allowed_mime_types を設定 |
| PR #19 (LOW-001) | avatar アップロード時の magic bytes 検証を実装（Content-Type 偽装対策） |
| PR #19 (LOW-002) | `defenseCustomInstruction` の型検証を追加（typeof !== "string" チェック） |
