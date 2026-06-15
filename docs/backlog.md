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

#### [FEAT-006] チャット回数の仕様変更（柔軟なラウンド制御 + 固定挨拶メッセージ）

- **現状**: ケース作成時に「2 回 / 3 回 / 5 回」の 3 パターンから `max_rounds` を選択。ユーザーが各ラウンドで挨拶含め自由入力。
- **変更内容**:
  - **デフォルト**: `max_rounds = 3` に固定（選択肢の撤廃）
  - **早期終了**: 3 回に満たなくても、両者の合意があればいつでも終了し判決へ進める。発火 UI は**チャット欄サイドの常設「終了を提案」アイコン**。片方が押すと相手に提案が通知され、双方が押した時点で確定して判決画面へ
  - **延長**: 3 回終了後、判決画面へ進む前に「続けたい / 終わりたい」の **2 択モーダル**を両者に提示。**どちらか一方でも「続けたい」を選択すると 3 回追加**（OR 条件、AND ではない）。追加後も同じ流れを繰り返せる
  - **挨拶の自動化**: 開始と終了の挨拶は固定メッセージとし、ユーザーの入力ではなくシステムが自動投入。挨拶メッセージはラウンドカウントに**含めない**（ラウンド外の固定メッセージとして扱う）
    - 開始時デフォルト: 「よろしくお願いします」
    - 終了時デフォルト: 「ありがとうございました。」
    - **保存先**: `profiles` に `opening_greeting` / `closing_greeting` の 2 カラムを追加。編集導線は既存プロフィール編集画面 (`/profile`) に項目追加（マイページからの導線は既存通り `/me` → 「プロフィール」セクション）
- **方針（2026-06-12 ダイチ判断）**: **旧データは実装フェーズの最初に全削除して新仕様に統一する**。本番は現状テストデータのみのため後方互換ロジックは作らない。
  - 削除対象: `cases` + cascade で `arguments` / `verdicts` / `judge_messages`
  - 削除スコープ: 本番 + テスト DB 両方
  - 実行タイミング: FEAT-006 実装 PR の最初のマイグレーション内に `DELETE FROM cases;` を記述（履歴に残す）。FK の cascade 設定が無い場合は明示的に下流テーブルから削除
- **設計上の論点**（実装時に整理）:
  - 「終了を提案」アイコンの状態管理（提案 → 相手承認の状態遷移を持たせるため `cases` に `end_proposed_by uuid` カラム追加が筋。NULL=未提案、UUID=提案者の user_id、両者押下＝確定で `phase=verdict` 遷移）
  - 延長分岐の OR 判定はサーバ API でやる（DB トリガに寄せず、`/api/cases/[id]/extend` 的なエンドポイントで両者の意思を集約）
  - `max_rounds` カラムは残す（初期値 3、延長のたびに +3 する形で履歴を保持）
  - 挨拶メッセージは `arguments` には積まず、`cases` 開始時 / 終了時に judge_messages として固定文を 1 行ずつ挿入する形（ダイチ確認待ち）
- **優先度**: 中
- **由来**: 2026-06-12 ダイチ依頼（早期終了 UI / 延長 2 択 / 挨拶 profiles 保存 / 旧データ削除統一は同日リードとの合意）

---

### 運用・テスト基盤（OPS）

#### [OPS-001] E2E 実行基盤の運用見直し

- **背景**: パイプラインのテスタ段階で E2E（Playwright）を回す前提が、本環境（Ubuntu）で課題を抱えていた。

- **Part 1（node 実行基盤）: 解決済み ✅**（2026-05-29）
  - 課題: Next.js 16 は node ≥ 20.9.0 必須だが、`claude -p` で起動するパイプライン各エージェントは volta-node18（claude の pin）を継承し直すため、テスタ内の `npm run dev` が node18 で起動失敗していた。さらに Playwright ブラウザ（chromium）が未導入だった。
  - 対応:
    - `package.json` に `volta.node = 20.20.2` を pin（PR #27 で同梱済み）。
    - `scripts/agents.sh` の `run_tester` が dev サーバーを**自前で node20 環境で起動/停止**するよう変更（PATH から node18 実体を除去し `_VOLTA_TOOL_RECURSION` を解除して volta シムに project pin を解決させる）。停止はポート 3000 のリスナーから実 PGID を特定してグループごと kill。テスタは playwright 実行のみ担当（ランナーは node18 で可）。
    - `docs/agents/tester.md` から dev サーバーの起動/停止指示を除去し「agents.sh が起動済み・確認のみ」に変更。
    - `run_tester` に Playwright chromium の自動導入ガードを追加（初回のみ）。
    - 判定ロジックを修正: 「実施不可」も不合格扱いにし、環境不備による未実施を誤って通過扱いにしない。
  - 検証: 読み取り専用テスト（VISUAL-BRAND-001）を node20 サーバー + node18 playwright + chromium で実行し、chain が end-to-end で動作することを確認済み。
  - **追記 (PR #30 / 2026-06-02)**: 2026-05-30 の claude CLI ネイティブ版移行（node 非依存、`~/.local/bin/claude`）により、claude → 子プロセスへの node18 強制（`_VOLTA_TOOL_RECURSION` 経由）が消滅した。これに伴い PR #30 で `package.json` の `volta.node` pin を撤去し、要件は `engines.node: ">=20.9.0"` で表明する形へ切り替えた。`scripts/agents.sh` の PATH サニタイズおよび `_VOLTA_TOOL_RECURSION` 解除処理も併せて撤去し、`start_dev_server` は素の `setsid bash -c "npm run dev"` に簡素化した。停止側の PGID 特定ロジックおよびテスタの判定ロジックは本筋なので残置している。

- **Part 2（E2E のターゲット DB）: メカニズム整備済み（本 PR）/ テスト用 Supabase プロジェクト作成は手動作業として残る**
  - 採用方針: テスト用 Supabase プロジェクト + `.env.test`（シード&クリーンアップ案は本番への漏れリスクが残るため不採用）
  - 本 PR で整備した内容:
    - `.env.test.example` テンプレを追加。`.env*` は既に gitignore 済み、`.env*.example` は例外として共有
    - `package.json` に `dev:test` スクリプト追加（`NODE_ENV=test next dev` で `.env.local` をスキップさせ `.env.test` を読ませる）
    - `playwright.config.ts` で `@next/env` の `loadEnvConfig` により spec へも `.env.test` を渡す
    - `scripts/agents.sh` の `run_tester` が `TEST_MODE=1` を export、`start_dev_server` が `TEST_MODE` 時に `dev:test` を起動し `.env.test` 不在なら die
    - `docs/agents/tester.md` の Playwright 実行手順を `.env.test` source へ更新
    - `docs/operations/e2e-test-db.md` を新設し、テスト用 Supabase プロジェクト作成 → schema 適用 → ユーザー作成 → `.env.test` 投入 → 動作確認の手順を全て文書化
  - 残作業（ダイチ手動）: テスト用 Supabase プロジェクトの作成・スキーマ適用・E2E ユーザー登録・`.env.test` の実値投入。docs/operations/e2e-test-db.md の手順通り。
- **優先度**: 中（Part 1 完了によりパイプラインで E2E が回せる。Part 2 メカニズム整備済み、運用準備はダイチが docs に従って実施）
- **由来**: 2026-05-29 LOW バッチ対応時に顕在化

---

#### [OPS-003] Vercel Preview デプロイメントのターゲット DB をテスト DB に分離

- **背景**: Preview と Production の env vars が同一 Supabase (`nhcsshqcyprbitfctyio`) を指しており、Preview での動作確認が本番 DB に書き込みを発生させる状態だった (2026-06-13 ダイチが両環境でケース残存を発見して判明)。
- **本来の方針**: Preview は「動作確認用」= 本番に未マージのロジックや migration 候補を試す場 = 本番 DB を触るべきではない。OPS-001 Part 2 で整備した E2E 用テスト Supabase (`eckrccrfnblzdbflnssf`) を Preview からも参照するように切り替える。
- **作業手順 (ダイチが Vercel ダッシュボードで実施)**:
  1. Vercel プロジェクト `family-court` → Settings → Environment Variables を開く
  2. 以下のキーについて Preview scope の値を `.env.test` の値で上書き（または Preview 専用変数として追加）:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     - `SUPABASE_SECRET_KEY`
     - `SUPABASE_ACCESS_TOKEN`
     - `SUPABASE_PROJECT_REF`
     - `ENCRYPTION_KEY`
     - `GUEST_TOKEN_SECRET`
  3. 暫定で本番のまま据え置く (将来検討):
     - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (test 側が空、Preview で rate limit 動作確認したい場合は別途 Upstash テスト用インスタンス作成が必要)
     - `NEXT_PUBLIC_SITE_URL` (preview URL は Vercel が自動付与する `VERCEL_URL` 経由が筋。コード側のフォールバック整備が前提のため別タスク)
  4. 既存 PR があれば Redeploy、なければ次の preview deployment から反映される
  5. 反映確認: preview URL でケース作成後、テスト Supabase (`eckrccrfnblzdbflnssf`) 側に行が増え、本番 (`nhcsshqcyprbitfctyio`) は増えないこと
- **設計上の論点 / 将来課題**:
  - `NEXT_PUBLIC_SITE_URL` のフォールバック: `process.env.NEXT_PUBLIC_SITE_URL ?? \`https://${process.env.VERCEL_URL}\`` 的な処理を入れて preview ごとの URL に合わせる
  - Upstash テスト用インスタンス作成 (rate limit を preview で正しく動作確認したい場合)
  - 将来「PR ごとに独立した DB」を望む場合は Supabase branching か Neon branching が選択肢
- **副次効果**:
  - Preview deployment の migration 適用順序が「test DB に先に適用 → preview で動作確認 → 問題なければマージ → 本番に適用」のフローに整理される
  - `applied.txt` の本番 / test の管理が今後分離する想定 (test 側は OPS-002 で議論されているサージカル手順の見直しと連携)
- **優先度**: 高（本番 DB を Preview で触らない衛生は早めに整えるべき）
- **由来**: 2026-06-13 ダイチ指摘。元々 OPS-001 Part 2 で E2E パイプライン専用に分離していたが、Preview/QA への適用は当初構想外だった

---

#### [OPS-002] テスト DB スキーマソースの整合性回復（schema.sql / migrations / docs 不整合）

- **背景**: OPS-001 Part 2 のセットアップ自走時（2026-06-10）に、`supabase/schema.sql` と `supabase/migrations/*.sql` の重複が原因で「schema.sql → migrations 全実行」を docs 通りに素直にやると最初の migration で停止することが判明。
- **症状**:
  - `supabase/schema.sql` が「初期スキーマ」ではなく **本番 DB の現スナップショット**になっており、`profiles.avatar_url` / `profiles.defense_custom_instruction` 列と `judge_messages` テーブルが既に含まれている
  - 一方 `supabase/migrations/20260524000000_create_judge_messages.sql` と `supabase/migrations/20260526000001_feat002_phase1_profiles.sql` の前半（ALTER TABLE profiles ADD COLUMN）は schema.sql と重複
  - `docs/operations/e2e-test-db.md` 通りに「schema.sql → migrations 全実行」を素直にやると 1 件目で `42710: policy "誰でも裁判官メッセージを参照可" for table "judge_messages" already exists` で停止する
  - 2026-06-10 のセットアップはサージカル対応（`20260524000000` 全スキップ、`20260526000001` は `sed -n '10,$p'` で storage 部分のみ流す）で完走させたが、再現性のある手順ではない
- **対応案**:
  - **A) schema.sql を初期スキーマ（migration 0 番目）に戻す**: 本番に流した履歴を後から書き換える形になるので OPS リスク要確認。ただし「migrations が完全な履歴」になり最も筋がいい
  - **B) migrations を冪等化**: `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS ... → CREATE POLICY` 等で重複実行を許容する。実装は軽いが「履歴の純度」は犠牲
  - **C) docs を分離**: `schema.sql` は「冷凍庫」と明示し、新規セットアップ向けに `supabase/setup.sql`（schema + migrations の合成版）を別途用意。docs を「冷凍庫運用」前提に整理
- **副作用 / 設計上の論点**:
  - 本番 DB の `supabase_migrations.schema_migrations` テーブルに既適用の migration ID が記録されているか確認が必要（記録あれば履歴改変のリスク）
  - 採用方針によって `scripts/setup-test-db.sh` 化（前セッションで構想）の難易度が変わる
- **優先度**: 中（テスト DB セットアップはサージカル手順で済む状態だが、`scripts/setup-test-db.sh` 化や次回プロジェクト立ち上げ時に再現性が壊れる）
- **由来**: 2026-06-10 OPS-001 Part 2 セットアップ自走中に発見

---

### 監査由来の品質改善

（現在、未対応の監査由来 LOW はない。過去の指摘は「対応済み」セクション参照。）

---

### バグ修正（BUG）

#### [BUG-004] ゲスト参加直後に弁護人 AI タブが表示されない（リロードで復帰）

- **症状**: 被告がゲストとして参加した直後、対話チャットのみが表示され「弁護人AI」タブが表示されない。ページをリロードすると弁護人 AI タブが現れる。
- **想定原因**: CaseRoom.tsx の `fetchDefenseMessages` 内で `showDefenseTab` を立てる経路が、ゲスト参加直後の cookie/session 確立タイミングと噛み合っていない可能性。`fetch /api/cases/[id]/defense` が初回 401/403 を返して `setShowDefenseTab(false)` に倒れているケースが疑わしい。
- **対応案**: 参加成功後（`handleJoinAsGuest` の `setMyRole("defendant")` 直後）に `fetchDefenseMessages()` を明示再実行する。あるいは defense API のゲスト判定経路を見直す。
- **優先度**: 中（ゲスト UX に直撃するが、リロードで回避可能）
- **由来**: 2026-06-13 ダイチ手動確認

---

#### [BUG-005] 「閉廷しました」アナウンスの表示条件を「ユーザーが終了を選んだ場合のみ」に限定する

- **症状**: 現状「閉廷しました」アナウンスが、ユーザーが終了を選んでいない場合（例: 3 ラウンド自然完了 → 延長投票で continue 選択など）でも表示されている可能性がある。
- **期待挙動**: ユーザーが明示的に終了を選んだとき（早期終了の合意成立、または延長投票で両者 finish）にのみ「閉廷しました」アナウンスを出す。
- **調査ポイント**: アナウンス生成位置（おそらく judge_messages か CaseRoom 内のラベル）を特定し、トリガを終了選択に限定する。
- **優先度**: 低（演出の整合性問題）
- **由来**: 2026-06-13 ダイチ手動確認

---

#### [BUG-006] 「終了を提案」時に相手側へ通知する

- **症状**: 現状、相手が「終了を提案」したことは polling 経由でバナー（`isOpponentEndProposal` 分岐）が表示されるが、相手画面が active でないと気づけない。
- **期待挙動**: 終了提案を受けた側に明示的な通知を出す（音、トースト、ブラウザ通知 API、もしくはバナーの強調アニメーション等、設計時に方式を整理）。
- **優先度**: 低（既存 polling バナーで最低限の伝達は機能）
- **由来**: 2026-06-13 ダイチ手動確認

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
| PR #31 (FEAT-RESP-HEADER) | ヘッダーをアバター起点のドロップダウンメニュー方式へ刷新（全画面サイズ統一、breakpoint 不使用）|
| PR #32 (FEAT-005) | マイページ `/me` を新設（プロフィール / フレンド / 過去のケース / 参加中の法律 のダイジェスト、ヘッダー導線に「マイページ」追加）|
| PR #33 (LOW-001) | `package.json` の `name` フィールド変更経緯を README に明示（PR #17 で `family_court` → `igiari` にリネーム済みの追跡性を回復、由来: `docs/knowledge/audit-log/audit_20260526_152517.md`） |
| PR #33 (LOW-002) | `@upstash/core-analytics` の外部送信不可検証（`analytics: false` 設定時に Analytics クラス未インスタンス化 + `if (this.analytics)` ガードで record/ingest 実行経路なし、本番ビルドのバンドル含有はコードのみで動作経路なし、由来: `docs/knowledge/audit-log/audit_20260526_152517.md`） |
| PR #35 (BUG-003) | 判決画面の説得力スコアが常に 0%/空になる現象を修正（`lib/case-response.ts` で verdict 行を snake_case のまま返していたのを camelCase へ明示マップ：`plaintiff_score → plaintiffScore` / `defendant_score → defendantScore` / `created_at → decidedAt`、他フィールドは単語 1 語で偶然動いていた、由来: 2026-06-02 ダイチ報告） |
| 本 PR (BUG-002) | 過去のケース表示時にチャット画面が一瞬出てから判決画面へ自動遷移する現象を修正（`app/case/[id]/page.tsx` を Server Component に変換し、`cases.phase === "verdict"` なら `redirect()` で即座に `/case/[id]/verdict` へ振り分け。既存のクライアント側ロジックは `CaseRoom.tsx` に分離。フェーズ進行に伴う in-session 遷移用の `router.push` は据置。由来: 2026-06-02 ダイチ報告） |
