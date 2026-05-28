# バックログ

プロダクトの未対応タスクを蓄積するファイルである。
オーディの監査指摘・ダイチの機能要望・改善案をまとめて管理する。
リードがセッション開始時・PR マージ後にダイチへ内容を共有する。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映すること。

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

### 監査由来の品質改善

#### [MEDIUM-001] Server Component の読み取りに createAdminClient() を使用（app/laws/page.tsx、app/laws/[id]/page.tsx）

**由来**: audit_20260526_200752.md

- **内容**: `app/laws/page.tsx` および `app/laws/[id]/page.tsx` は、認証確認後のすべての DB 読み取りに `createAdminClient()` を使用している。`design.md` の「Server Component からの読み取りは `createSessionClient()` を使用し、以下のポリシーで保護する」という仕様に反する。`createAdminClient()` は RLS をバイパスするため、SELECT ポリシー（`laws_select_member`、`law_invitations_select` 等）が適用されない。現状は各クエリにアプリ層フィルタ（`.eq("invitee_id", user.id)`、メンバーシップ確認後の `.in("id", lawIds)` 等）が正しく付与されており、データ漏洩は発生していない。しかし RLS による二重防御が機能せず、将来の開発者がアプリ層フィルタを誤って削除・省略した場合に即座にデータが露出するリスクがある。
- **影響範囲**: エンドユーザーへの直接影響は現時点でなし。ただし防御の単一障害点化により、メンテナンス時の誤実装がデータ漏洩に直結する。
- **修正案**: Server Component 内の DB 読み取りを `createSessionClient()` に切り替える。`laws/page.tsx` の `createAdminClient()` 呼び出し（line 13）を削除し、`createSessionClient()` の戻り値を用いてデータ取得に使う。`laws/[id]/page.tsx` も同様（line 20）。RLS ポリシーが SELECT を invitee 本人・メンバーのみに制限しているため、フィルタを省略しても安全な読み取りになる。

---

#### [LOW-001] `anon` ロールへの不要な SELECT 権限付与（supabase/migrations/20260526000002_feat002_phase2_friends.sql:29）

**由来**: audit_20260526_142833.md

- **内容**: `GRANT SELECT ON public.friend_requests TO anon;` により、未認証のブラウザクライアント（anon キー）も `friend_requests` テーブルに対して SELECT 権限を持つ。現時点では RLS ポリシー `friend_requests_select_own` が `USING (sender_id = auth.uid() OR receiver_id = auth.uid())` で制御しており、anon リクエストでは `auth.uid()` が NULL を返すため実際の行は一切返らない。機能上の問題はないが、最小権限の原則に反する。将来誰かが RLS ポリシーを変更・削除した場合（migration ミス、Supabase ダッシュボード操作など）、フレンド関係の全データが未認証ユーザーに公開されるリスクがある。
- **エンドユーザーへの影響**: 上記の状態変化が起きた場合、全ユーザーのフレンド関係（誰と誰がつながっているか）が漏洩する。
- **修正案**: `GRANT SELECT ON public.friend_requests TO anon;` の行を削除する。`anon` ロールは直接クライアントからの読み取りに使われるが、`friend_requests` へのアクセスはすべて API Route（service_role）経由で行われるため、anon への GRANT は不要である。

---

#### [LOW-002] 存在しない receiver_id に対する FK 違反（23503）が未処理で 500 を返す（app/api/friends/requests/route.ts:102-107）

**由来**: audit_20260526_142833.md

- **内容**: `POST /api/friends/requests` は `receiver_id` の UUID v4 形式を正規表現で検証している（line 72）が、その UUID が `profiles.id` に存在するかどうかは確認しない。存在しない UUID を `receiver_id` として送信した場合、`friend_requests.receiver_id` の外部キー制約（`REFERENCES profiles(id)`）が PostgreSQL エラーコード 23503 を返す。コードは `23505`（重複）のみ個別ハンドルしており（line 103）、23503 はライン 106-107 の汎用 500 分岐に落ちる。レスポンス本文は `"リクエストの送信に失敗しました"` となりエラーコードを露出しないが、ステータスコードが 500（サーバー障害）になることは誤りであり、適切な 400（クライアント入力エラー）と区別できない。
- **エンドユーザーへの影響**: フロントエンドは 5xx をサーバー側の障害として扱うため、ユーザーへの誤ったエラーメッセージ表示や不要なリトライが発生する可能性がある。ただし存在しない UUID を UI から送る経路は通常ないため、現実の発火は限定的。
- **修正案**: `insertError.code === "23503"` を個別ハンドルして 400 または 404 を返す。

---

#### [LOW-001] `package.json` の `name` フィールド変更が変更ログ未記載（`package.json:2`、`package-lock.json:4`）

**由来**: audit_20260526_152517.md

- **内容**: `package-lock.json` の `name` フィールドが `"family_court"` から `"igiari"` へ変更されている。`package.json` の現在値も `"igiari"` である（2行目）。しかし eng-to-aud.md の「変更ファイル一覧」では `package.json` の変更理由を `@upstash/*` 依存追加のみと説明しており、`name` フィールドの変更への言及がない。意図的なプロジェクト名変更であれば問題ないが、本監査ではその意図を文書から確認できない。エンドユーザーへの直接影響はないものの、Vercel のプロジェクト名・CI 設定と乖離した場合にデプロイのトレーサビリティが失われる。
- **修正案**: 変更が意図的であれば eng-to-aud.md の変更ファイル一覧に `package.json — name フィールドを igiari へ変更` を追記する。意図的でない場合は `"name": "family_court"` に戻す。

---

#### [LOW-002] `@upstash/core-analytics` が本番依存ツリーに混入（`package-lock.json`）

**由来**: audit_20260526_152517.md

- **内容**: `analytics: false` を明示設定しているにもかかわらず、`@upstash/ratelimit@2.0.8` の推移的依存として `@upstash/core-analytics@0.0.10` が `node_modules` に含まれる（`package-lock.json` に `node_modules/@upstash/core-analytics` エントリあり）。このパッケージがモジュール初期化時にアウトバウンド接続を行わないことをコードレベルでは確認できない。`ratelimit.limit(user.id)` は毎リクエストごとに `user.id`（UUID）を渡すため、万一 `analytics: false` が完全に機能していない場合、ユーザー識別子が Upstash のサードパーティサーバーへ送信されうる。本アプリは夫婦・家族の話し合いというプライバシー高感度なドメインであるため、ユーザー識別子の外部送信リスクは軽視できない。
- **修正案**: `@upstash/core-analytics@0.0.10` の GitHub リポジトリ（upstash/core-analytics）でソースを確認し、`analytics: false` 時にアウトバウンド接続が発生しないことを検証する。または `npm run build` 後に `grep -r "core-analytics" .next/server/` を実行し、analytics 呼び出しがサーバーバンドルに含まれないことを確認する。

---

#### [LOW-003] URL パスパラメータの UUID バリデーション未実施

**由来**: audit_20260526_200752.md

- **内容**: 全 API ルートの `lawId`、`invId`、`propId` がリクエスト URL から取得した生の文字列のまま Supabase クエリの `.eq("id", ...)` に渡されている。招待 POST (`app/api/laws/[id]/invitations/route.ts:5`) の `invitee_id`・オーナー移譲 PATCH (`app/api/laws/[id]/owner/route.ts:5`) の `new_owner_id` はリクエストボディで UUID 形式を検証しているが、パスパラメータ側の検証は行われていない。Supabase は UUID 型カラムへの非 UUID 値を PostgreSQL エラーとして返すため、現時点で実際のデータ操作は発生しないが、エラーレスポンスの形式が不統一になる（PostgreSQL エラーが 500 として漏洩する可能性）。
- **影響範囲**: 悪意ある入力者が不正な文字列を渡した場合に Supabase エラーログが汚染される。データ漏洩・改ざんの直接リスクは低い。
- **修正案**: 各ルートの先頭で `UUID_REGEX.test(lawId)` 等のチェックを追加し、不正な場合は 400 を返す。`invitations/route.ts` に定義済みの `UUID_REGEX` を共通ユーティリティとして `lib/utils.ts` 等に移動して使い回す。

---

#### [LOW-004] PendingInvitations.tsx で HTTP レスポンスステータスを検査していない（app/laws/_components/PendingInvitations.tsx:29-36）

**由来**: audit_20260526_200752.md

- **内容**: `respond` 関数内で `fetch(...)` の戻り値 (`Response`) を検査せず、常に `router.refresh()` を実行している。API が 403・404・500 を返した場合でもリフレッシュが走り、ユーザーはエラーメッセージを受け取れない。ページリフレッシュ後は招待が残ったまま表示されるため誤操作防止にはなるが、「なぜ消えないのか」が伝わらず連打を誘発する可能性がある。セキュリティ上の直接影響はないが、失敗時の招待重複クリックがサーバー側に余分なリクエストを送る。
- **影響範囲**: エンドユーザーへの UX 劣化。サーバー側の状態変化は発生しない（PATCH の冪等性により安全）。
- **修正案**: `const res = await fetch(...)` → `if (!res.ok) { /* エラーメッセージを state にセット */ return; }` を追加し、承認/拒否失敗時にインライン警告を表示する。

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
| PR #20 (LOW-001) | フレンド検索の入力サニタイズ・追加品質修正 |
| PR #20 (LOW-002) | 表示名取得時のエラーハンドリング追加 |
| PR #21 (MEDIUM-001) | `/api/users/search` に Upstash Redis レートリミットを実装 |
| PR #22 (FEAT-003) | 法律作成機能（作成・招待・投票・退会・改定・所有権移譲） |
| PR #23 (BUG-001) | サインアップ時の確認メール未着を修正（Gmail SMTP・emailRedirectTo の明示化） |
| PR #24 (chore) | トークン消費の可視化（statusline.py・token_report.py）とログローテーション機構（rotate_logs.sh） |
