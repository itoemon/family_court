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


### [MEDIUM-001] BUG-005 必須シナリオ #2/#3 が E2E spec に存在せず未検証（tests/e2e/bug005-closing-trigger.spec.ts:133-168） (由来: audit_20260615_165040.md)
- **内容**: (由来: audit_20260615_165040.md)
  task.md L108-116 の「必須」テスト観点として、以下 2 件が指定されている。 (由来: audit_20260615_165040.md)
    - #2: 3 ラウンド完了 → 両者 finish → `phase=judging`。closing greeting 2 行 (`arguments`) と AI 閉廷宣告 1 行 (`judge_messages`) が挿入され、`arguments.created_at` < `judge_messages.created_at` の順序であることを assert。 (由来: audit_20260615_165040.md)
    - #3: 早期 end-proposal 両者合意 → `phase=judging`。同様に挿入と順序を assert。 (由来: audit_20260615_165040.md)
 (由来: audit_20260615_165040.md)
  実際の `tests/e2e/bug005-closing-trigger.spec.ts` を確認したところ、 (由来: audit_20260615_165040.md)

---

### 運用・テスト基盤（OPS）

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

#### [BUG-008] `useSearchParams()` を使う Client Component に Suspense 境界がない

- **症状**: `app/auth/login/page.tsx` と `app/case/[id]/CaseRoom.tsx` で `useSearchParams()` を直接呼び出しているが、いずれも最寄りの祖先で `<Suspense>` でラップされていない。`app/layout.tsx:44` の `<Suspense>` は `<Header />` のみを包んでおり、`{children}` 配下には Suspense 境界が存在しない。
- **影響**: 現時点ではテスタ実行で build エラー・ランタイム警告が観測されていない。両ページとも `"use client"` 全体で初めからクライアント側レンダリングであり静的化されていないため実害なし。ただし Next.js の公式ガイダンスでは Suspense ラップが推奨されており、将来 Next.js の静的最適化が強化された際に build 警告が出る可能性がある。
- **修正案**: 各 `page.tsx` を Server Component に分割し、内部 Client Component（例: `LoginForm` / `CaseRoom`）を `<Suspense fallback={...}>` でラップする。`/auth/login` と `/case/[id]` の両方に同時適用するのが筋。
- **優先度**: 低（予防的）
- **由来**: 2026-06-15 BUG-007 監査（audit_20260615_095410.md LOW-001）

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
| PR #29 (OPS-001 Part 1) | E2E 実行基盤を node20 で動かす整備（パイプラインの dev サーバ起動経路の修正、Playwright chromium 自動導入ガード、判定ロジックの「実施不可も不合格」変更。後の PR #30 で claude CLI ネイティブ移行に伴い PATH サニタイズと volta pin は撤去された、由来: 2026-05-29 LOW バッチ対応時に顕在化） |
| PR #36 (BUG-002) | 過去のケース表示時にチャット画面が一瞬出てから判決画面へ自動遷移する現象を修正（`app/case/[id]/page.tsx` を Server Component に変換し、`cases.phase === "verdict"` なら `redirect()` で即座に `/case/[id]/verdict` へ振り分け。既存のクライアント側ロジックは `CaseRoom.tsx` に分離。フェーズ進行に伴う in-session 遷移用の `router.push` は据置。由来: 2026-06-02 ダイチ報告） |
| PR #37 (OPS-001 Part 2) | E2E を本番 DB から分離する env スイッチ機構を整備（`.env.test.example` テンプレ追加、`dev:test` スクリプト、`playwright.config.ts` で `@next/env` 経由の `.env.test` 読み込み、`scripts/agents.sh` の `TEST_MODE=1` 配線、`docs/operations/e2e-test-db.md` 新設。テスト用 Supabase プロジェクト作成 → スキーマ適用 → ユーザー登録 → `.env.test` 投入は 2026-06-10 にダイチが手動完了済み） |
| PR #38 (chore/lint) | E2E spec の `page: any` 警告と `CaseRoom.tsx` の effect 内 setState 警告を解消（spec は `import { type Page }` で型注釈、CaseRoom は `useCallback` で安定参照化） |
| PR #39 (chore/spec) | E2E spec の弱 assertion 6 箇所を hard assertion へ置換（`toBeGreaterThanOrEqual(0)` / `expect(... || true).toBe(true)` 等を撤去し、レスポンスステータス検査と明示 visibility assertion へ統一） |
| PR #40 (feat/ui) | ブランドトーンの `error.tsx` / `not-found.tsx` を追加（既存の `brand-700/800` パレットとフォントトーンを継承、Sentry 等の外部依存なし、`reset()` で復帰可能なエラーバウンダリ） |
| PR #41 (FEAT-006) | チャット回数の柔軟化と固定挨拶導入（`max_rounds=3` 固定 + OR 条件の延長投票 3 ラウンド追加、`profiles.opening_greeting/closing_greeting` の固定挨拶をシステム自動投入、早期終了は `cases.end_proposed_by` の状態遷移で両者押下時に判決へ。実装フェーズ初頭で旧 cases データを `DELETE FROM cases;` で全削除、後方互換ロジックなし、由来: 2026-06-12 ダイチ依頼） |
| PR #42 (OPS-003) | Vercel Preview のターゲット DB を test Supabase (`eckrccrfnblzdbflnssf`) に分離（Vercel REST API で Preview scope の 5 キーを test 値に上書き、UPSTASH 2 キーは preview+production 共有、`NEXT_PUBLIC_SITE_URL` は signup ページ側で `window.location.origin` フォールバックを追加してコードで動的解決、由来: 2026-06-13 ダイチ指摘） |
| PR #44 (BUG-007) | ログイン成功後にページ遷移しない問題を修正（`router.refresh()` を削除して `router.push` の効果が打ち消されないように変更、`useSearchParams().get("next")` で `?next=` を解釈、`new URL(rawNext, window.location.origin)` ベースの open redirect ガードを実装して backslash バイパス・`javascript:` スキーム・protocol-relative URL を一括防御、由来: 2026-06-15 ダイチ手動確認） |
| PR #45 (BUG-004) | ゲスト/アカウント参加直後に弁護人 AI タブが表示されない問題を修正（`handleJoinAsAccount` / `handleJoinAsGuest` の参加成功直後に `await fetchDefenseMessages()` を明示呼び出し。`useEffect([fetchDefenseMessages])` の初回 fetch が参加前の 401/403 で `showDefenseTab=false` に倒れていた根本原因に対処、両経路同時修正、由来: 2026-06-13 ダイチ手動確認） |
| PR #46 (BUG-004 補修) | PR #45 で add し忘れた `tests/e2e/bug004-defense-tab.spec.ts` と audit-log / test-log を補修コミット（コミット忘れ事故 2 回連続の教訓を `feedback_commit_check.md` に運用化、由来: PR #45 マージ後の漏れ検知） |
| PR #47 (middleware) | 保護パスのリダイレクトに `?next=` を付与（`middleware.ts` で `/auth/login` リダイレクト時に `loginUrl.searchParams.set("next", pathname + request.nextUrl.search)` を追加。login ページ側は PR #44 で既に URL パーサベースの open redirect ガードを持つため、これだけで「保護パス → ログイン → 元のページに戻る」フローが完成、由来: BUG-007 の意図的スコープ外残宿題） |
