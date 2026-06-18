---
name: session-context
description: リードの直近セッションの要約。新しいチャットを開いたときに会話の文脈を引き継ぐために使う
metadata:
  type: project
---

# セッション引き継ぎ

新しいチャットを開いたら、リードはこのファイルを読んで前回の状況を把握する。
**更新タイミング**: リードの判断で好きなタイミングで更新可能 ([[feedback-session-context]] 参照)。

---

## 最終更新: 2026-06-18（FEAT-004 法案 Hub #57 + laws RLS 再帰修正 + 本番 migration 適用。これまでに PR #41-#58）

### 現在のブランチ・PR 状態

- 現ブランチ: `main`（クリーン、HEAD `331b536` = PR #58 マージ後）
- オープン PR: なし
- 本連続セッション (2026-06-13〜2026-06-18) でマージした PR: #41〜#58（#48/#52/#54/#58 は backlog/bookkeeping）

### このセッション (2026-06-18 後半) でやったこと: FEAT-004 法案 Hub

#### F. PR #57 マージ: FEAT-004 法案 Hub（公開・インポート）+ laws RLS 無限再帰の恒久修正

- **スコープ確定 (ダイチ)**: ① is_public トグル ② 純クローン import ③ Hub 認証ユーザーのみ
- **実装**: `laws.is_public` + `laws_select_public`（既存ポリシー無変更で OR 評価）/ visibility PATCH（オーナーのみ・updated_at 据置）/ public GET（Hub 一覧・`owner_id` 非返却・`PublicLawListItem` 型遮断・name 検索・50 件上限）/ import POST（純クローン・元法律不変）/ `/laws/hub` ページ（SSR + debounce 検索 + AbortController）/ 公開トグル UI。`lib/laws-public.ts` に取得整形を一本化。非メンバーの `/laws/[id]` ゲートは未緩和
- **フルパイプライン自走**: アーキ（design.md 末尾に純追記 407 行・既存無変更）→ ビルド（feature/20260618-181925、15 ファイル）→ テスタ → オーディ。各成果物をレビュー
- **重大発見: laws RLS 無限再帰 (42P17)**: FEAT-004 で laws を session client 読みして露見。`law_members_select` の自己参照 + `laws`↔`law_invitations` 相互参照で、認証ユーザーの laws 読み取りが**全滅**（本番でも壊れてた＝低頻度で未発覚）。owner 短絡でも planner がサブクエリ展開して再帰検出
- **修正 (ダイチ: FEAT-004 内で一緒に)**: `private.is_law_member()`/`is_law_owner()` の SECURITY DEFINER 関数（RLS バイパス）で再帰遮断。5 ポリシーを関数経由へ張り替え（セマンティクス不変）。PUBLIC EXECUTE は REVOKE
- **オーディ 3 件 PR 内消化**: MEDIUM-001（SD 関数を public→private へ。public だと PostgREST RPC でメンバー関係 boolean オラクル化）/ LOW-001（Hub 検索の空文字復帰）/ LOW-002（日付 TZ 非依存化）
- **コパ 5 件 PR 内消化**: AbortController / route の error→500 / migration の REVOKE / 件数上限の定数参照 / etc
- **検証**: feat004 spec 3/3 + laws spec 4/4、A の JWT で 42P17 消失・`/rpc/is_law_member` 404 確認、lint/tsc クリーン
- **本番 DB へ 2 migration 適用済み (PR #57 マージ後)**: `.env.local` を source し本番 ref (nhcsshqcyprbitfctyio) をガードして Management API 適用。is_public 列・RPC 封鎖・PostgREST 反映を検証。**本番の laws 機能も復旧**
- **PR #58**: applied.txt に本番適用済み記録 + backlog で FEAT-004 を対応済みへ

### このセッション (2026-06-18) でやったこと

#### A. PR #52 マージ: backlog ドリフト整理（BUG-006 削除 + PR #49/#50/#51 を対応済みへ）

- BUG-006 は PR #51 で対応済みなのに「未対応」に残っていたため削除（バグ修正セクションはプレースホルダ化）
- 対応済みテーブルに PR #49/#50/#51 の 3 行を追記（#48 は backlog 整理のみのため従来慣例どおりテーブル外）
- docs のみ。コパ COMMENTED 0 件でマージ

#### B. PR #53 マージ: OPS-002 テスト DB スキーマ整合性回復（approach B 冪等化）

- **方針判断**: ダイチが A/B/C から **B（冪等化）** を選択。理由は本番 introspection 不要・低リスク・差分小・docs フロー維持
- **調査で判明した正体**: `schema.sql`（170 行）は **本番の現スナップショット**で、feat006 適用後の状態（profiles の挨拶列・cases の `end_proposed_by`/`extension_vote_*`・arguments の `is_greeting` まで含む）。`cases`/`profiles` の**ベーステーブルを作る migration は存在しない**（migrations は judge_messages から始まる）ため schema.sql はベース必須。一方 judge_messages policy・profiles 列・feat006 列を migration も定義するため二重定義 → docs どおり「schema.sql → migrations 全実行」で 42710 / duplicate column 停止
- **修正**: 二重定義の 3 ファイルのみ冪等化。`20260524000000`（judge_messages policy に `DROP POLICY IF EXISTS` 前置）/ `20260526000001`（profiles 列 `ADD COLUMN IF NOT EXISTS` + storage policy 4 件 drop 前置）/ `20260612164035`（cases・profiles・arguments の feat006 列 `ADD COLUMN IF NOT EXISTS`）。schema.sql に無いテーブル（contradiction_warnings/defense_messages/guest_tokens/friends/laws）は fresh setup で 1 回作られ衝突しないため対象外
- **検証手法（恒久知識）**: 全オブジェクト適用済みの test DB (`eckrccrfnblzdbflnssf`) は **fresh setup で「schema.sql 適用後に migration が当たる」最悪ケースと等価**。Management API (`POST /v1/projects/{ref}/database/query`) で 3 ファイルを再適用 → 42710/duplicate column ゼロ、judge_messages policy 1 件・avatars policy 4 件が正常再作成、`delete from cases` を除外したため cases データ無傷(99行)を確認。`.env.test` を `set -a; source` して test token/ref を使用
- **applied.txt は独自管理**: Supabase ネイティブ移行履歴 (`supabase_migrations.schema_migrations`) は不使用。run_migrations (agents.sh) が applied.txt で skip 制御するだけなので、approach A の「本番履歴改変リスク」は実質ゼロだった
- アプリコード差分なし → パイプライン未経由、検証は test DB 直接適用で実施

#### C. PR #54 マージ: backlog の OPS-002 を対応済みへ移管

- PR #53 マージ反映。OPS セクションをプレースホルダ化、対応済みテーブルに PR #53 行追記。docs のみコパ 0 件マージ

#### D. PR #55 マージ: scripts/setup-test-db.sh でテスト DB セットアップ自動化

- OPS-002 の冪等化で「schema.sql → migrations 全実行」が通るようになったので、手動 SQL Editor 手順を 1 コマンド化（OPS-002 と地続きの follow-up）
- 仕様: `.env.test` を source して実行、Management API 経由で schema.sql → migrations/*.sql を昇順適用。**本番 ref ブロック**（`nhcsshqcyprbitfctyio` 拒否）+ **既初期化チェック**（`public.profiles` 存在時は schema.sql 非冪等のため拒否、空プロジェクト専用）+ `--dry-run`
- **検証**: 構文 / --dry-run / 本番ブロック / env 未設定 / populated test DB への通常実行で既初期化検出＝安全停止、の 5 シナリオ。実 SQL は OPS-002 で冪等性実証済みなので test DB を壊さず検証完了（preflight が initialized を検出して止まる＝ハーネス全体のスモークテスト）
- **コパ 4 件消化** (1 PR 1 review): `ls` パース→nullglob 配列 / `curl -sS` + 明示 die / `--help` の shebang 混入除外 / docs に curl・jq 前提明記。すべて LOW、PR 内自己修正してから判定マージ
- スコープ外: テスト DB の**定期リセット**（public スキーマ drop/recreate）は破壊的 + grant 復元が絡むため別タスク（e2e-test-db.md 残課題に継続記載）

#### E. PR #56 マージ: LOW-001-BUG005 api_key SET 経路の E2E 動的検証

- 問題: e2e_user_a の `api_key_encrypted=NULL` のため BUG-005 の主要価値（AI 閉廷宣告の INSERT + greeting→AI 順序）が CI で一度も踏まれず、リグレッション検知に空白
- 対応: `lib/judge.ts:generateJudgeMessage` に `TEST_MODE=1` モック分岐（実 Anthropic 回避、決定的非空文字列）。spec に BUG-005-4 追加（**専用 ephemeral plaintiff** を admin で作成し api_key を SET、SET 経路を隔離検証、後始末で case→user 削除）
- **設計判断**: 共有 e2e_user_a に key を立てず専用ユーザーで隔離（`workers:1` だが隔離性重視）。`handle_new_user` トリガが profile を自動生成、`profiles.id` は `on delete cascade` なので user 削除で profile も消える。case が plaintiff_id を FK 参照するため cleanup は case→user の順
- **TEST_MODE の届き方**: agents.sh が `export TEST_MODE=1` → claude -p テスタ → Bash → playwright と継承、dev:test サーバ(setsid)も同シェルから継承。両方が見るので spec の `test.skip(TEST_MODE!=='1')` ガードは CI で実行、未設定の手動実行では skip
- **コパ 5 件消化** (1 PR 1 review): 本番 TEST_MODE 誤設定ガード(production は無視+警告) / spec の TEST_MODE skip ガード / ENCRYPTION_KEY 形式チェック / メール一意化(Date.now+randomBytes) / cleanup delete エラー warn
- 検証: dev:test (TEST_MODE=1) で bug005 4/4 通過、cleanup 残骸 0、e2e_user_a 汚染なし

### このセッション (2026-06-13〜06-15) でやったこと

#### 1. PR #41 マージ: FEAT-006 チャット回数仕様の柔軟化 + 固定挨拶

- 挨拶を固定文化（`profiles.opening_greeting/closing_greeting`）してシステム自動投入、ユーザー手動入力 UI を撤廃
- `cases.phase` から `opening`/`closing` を実質スキップ（`waiting → argument → extension_voting → judging → verdict`）し、参加 PATCH で直接 `phase=argument` に遷移
- 早期終了（`end-proposal`）と延長投票（`extension-vote`）の API + UI 追加
- マージ前に旧 cases データ（3 件、いずれも phase=verdict）を本番 DB から `DELETE FROM cases;` で削除
- パイプライン未経由（オーディ MEDIUM/LOW 5 件 + コパレビュー 7 件は同 PR 内で消化）

#### 2. PR #42 マージ: OPS-003 Preview を test DB に分離（途中で `.env.local` 大事故 → 復旧）

- 経緯: ダイチが「Preview と本番が同じ DB を見てる」と気付き、Preview deployment が本番 DB に書き込んでいた問題が判明（OPS-001 Part 2 で整備した test DB を Vercel Preview にも適用していなかった）
- Vercel ダッシュボードでの env vars 設定が大袈裟だったので、ダイチが Vercel CLI 経由の自動化を希望 → リードが `npm i -g vercel` でインストール
- **大事故**: ダイチが `! vercel link` 実行した際、Vercel CLI が `.env.local` を **空 + `VERCEL_OIDC_TOKEN` のみ** で上書き（CLI が自動で `vercel env pull` を走らせる挙動）
- **復旧**:
  - `vercel env pull --environment=production` で sensitive 以外を復元（Vercel の `sensitive` type は読み取り API でも値を返さない仕様で 6 キーが空のまま）
  - ダイチが `./temp/env.local` に過去のバックアップを置いてくれていたので、SUPABASE_ACCESS_TOKEN だけ最新発行版を保持しつつ他をバックアップで埋めて復旧
  - `./temp/` が gitignored でなかったため即削除
- 本来の作業: Vercel REST API（`/v10/projects/{id}/env`）で Preview scope の 5 キーを test 値に上書き、UPSTASH 2 キーは preview+production 共有、`NEXT_PUBLIC_SITE_URL` は signup ページのコード fix（`window.location.origin` フォールバック）で動的解決
- test DB の auth config（`mailer_autoconfirm:false`, SMTP=Gmail, `uri_allow_list` に preview wildcard `*-daichis-projects-9e45ae6c.vercel.app/auth/callback`）を本番ベースで設定。SMTP の access token は `.env.local` の token では test project の権限がなく、`.env.test` の token（test project 専用に発行されていた）で PATCH 成功
- **判明したこと**: Supabase の access token は project ごとに発行する場合がある。`.env.local` と `.env.test` の SUPABASE_ACCESS_TOKEN は別物

#### 3. PR #43-#44 マージ: BUG-007 ログイン後にページ遷移しない（初パイプライン経験）

- PR #43: backlog 追加のみ
- PR #44: 修正 + 初の本格パイプライン経由
- **原因 2 つ**:
  - `router.push("/")` 直後の `router.refresh()` が current page（login）を再描画して push の遷移効果を打ち消す
  - `next` クエリパラメータ未解釈
- **修正**: `router.refresh()` 削除、`useSearchParams()` で `?next=` 対応、open redirect ガード（URL パーサベース `new URL(rawNext, window.location.origin)` で origin 一致時のみ採用）
- **パイプライン**: テスタ → オーディ → 4 回ループ
  - オーディ初回: HIGH-001（open redirect）指摘 → URL パーサベース防御に置き換え
  - オーディ 2 巡目: LOW 2 件（backslash バイパス、負例 E2E 欠落）→ 同 PR 消化
  - オーディ 3 巡目: HIGH-001（修正が **コミット未 push** で HEAD に反映されていない）+ MEDIUM-001（spec が **untracked**）→ commit 漏れを catch される
  - オーディ最終: LOW 1 件（Suspense 境界）→ BUG-008 として backlog 化
- 学び: オーディは git status と HEAD の照合で「実装と PR の齟齬」を catch する能力がある

#### 4. PR #45-#46 マージ: BUG-004 ゲスト/アカウント参加直後の弁護人 AI タブ非表示（コミット忘れ事故 2 回目）

- 原因: CaseRoom の `useEffect([fetchDefenseMessages])` がマウント時 1 回だけ呼ばれ、参加成功イベントに反応しない設計だった。参加前は defense API が 401/403 を返し `showDefenseTab=false` に倒れ、参加後は再 fetch されないままリロードで復帰、というのが正体
- 調査でアカウント経路にも同種バグが潜在することが判明 → 両経路修正
- **修正**: `handleJoinAsAccount`/`handleJoinAsGuest` の参加成功直後に `await fetchDefenseMessages()` を明示呼び出し
- **パイプライン**: テスタ → オーディ → 3 巡＋コパ
  - オーディ初回: LOW 3 件（try/catch 分離、disable 一貫性、関数移動順）→ 同 PR 消化
  - オーディ 2 巡目: LOW 2 件（私が前回 finally を消した結果 setLoading 漏れ + コメント不整合）→ 同 PR 消化
  - オーディ最終: LOW 1 件（restoreRole race comment）→ 同 PR 消化
  - コパ 3 件（unhandled rejection、E2E 追加要望（済）、task.md 注記矛盾）→ コパ #1 と #3 を消化
- **PR #46 でやり直し**: 私が PR #45 マージ時に `tests/e2e/bug004-defense-tab.spec.ts` と audit-log/test-log を **add し忘れ**。PR #44 (BUG-007) で同じパターンの指摘を受けたばかりなのに再発させた → PR #46 で補修

#### 5. PR #47 マージ: middleware の `?next=` 付与（BUG-007 残宿題回収）

- BUG-007（PR #44）で意図的にスコープ外にした残宿題を回収
- **修正**: `middleware.ts:37-39` の `/auth/login` リダイレクトに `loginUrl.searchParams.set("next", pathname + request.nextUrl.search)` を追加。元のクエリも保持
- login ページ側は BUG-007 で既に `useSearchParams().get("next")` + URL パーサベースの open redirect ガードを持つため、これだけで「保護パス → ログイン → 元のページに戻る」フローが完成
- **パイプライン**: テスタ 9/9 通過（CRITICAL 4 + FEAT-MIDDLEWARE-NEXT 5）、オーディは HIGH 0 / MEDIUM 0 / LOW 2（spec ヘルパーの未使用 + page: any）→ 同 PR 消化
- **コミット忘れなし**: 直前で `feedback_commit_check.md` を運用化した直後の PR で、commit 前に git status を確認して spec / ログを取りこぼさず 1 発成功。運用化が即実証された
- コパ 1 件は E2E カバレッジ指摘だが新規 spec で対応済み、追加対応不要

#### 6. memory 更新を main に直 commit (`1e2d3c4`, `c97f371`)

- 2026-06-15 ダイチが「`./memory` はリードの個人用なので好きなタイミングで更新可」と緩和してくれたため、memory 更新分を別 PR でなく main 直 commit で反映（[[feedback-session-context]] のポリシー緩和を反映）
- 内容: session_context（06-15 セクション追加）、feedback_session_context（緩和方針反映）、feedback_commit_check（新規）、MEMORY.md（index 更新）

#### 7. PR #48 マージ: backlog 11 PR 分の対応済み整理 + OPS-001 完了反映

- 累積していた対応済み移管漏れを一括整理。`docs/backlog.md` の差分は `-107 +12` (主に削除)
- **未対応セクションから削除**: FEAT-006 (PR #41) / OPS-003 (PR #42) / BUG-004 (PR #45/#46) / BUG-007 (PR #44) / OPS-001 (Part 1 = PR #29, Part 2 = PR #37、テスト DB 手動セットアップは 2026-06-10 にダイチ完了済み)
- **対応済みテーブル更新**: 「本 PR (BUG-002)」表記を「PR #36」へ正規化、PR #29 (OPS-001 Part 1) / #37 (OPS-001 Part 2) / #38 (lint) / #39 (spec hard assertion) / #40 (error.tsx) / #41 (FEAT-006) / #42 (OPS-003) / #44 (BUG-007) / #45 (BUG-004) / #46 (BUG-004 補修) / #47 (middleware ?next=) を追記
- backlog 追加のみの PR (#43) は過去の慣例 (#25/#28/#34) と同様にテーブル外
- パイプライン未経由（docs 整理のみ）、Vercel preview CI のみで通過
- ダイチ確認: 当初リードが「ダイチがマージ」と書いたが、過去 PR #41-#47 もリード自走でマージしてた前例に照らしてリード自走でマージ ([[feedback-pipeline-runner]] の徹底)

#### 8. PR #49 マージ: BUG-005 閉廷アナウンス条件の修正

- AI 生成「閉廷宣告」(`judge_messages.trigger_type='closing'`) の発火位置を「全ラウンド完了 → `phase=extension_voting` 遷移時」から「ユーザーが終了確定 = `phase=judging` 遷移時」へ移動
- 新規ヘルパー `lib/case-closing.ts:insertClosingJudgeMessage` を `judge_messages` への closing INSERT 専用として切り出し、`end-proposal` / `extension-vote` の `phase=judging` 遷移成功直後に呼ぶ。closing greeting (`arguments`、既存 `insertClosingGreetingsForCase` 流用) → AI 閉廷宣告 (`judge_messages`) の順序を呼び出し側で固定
- `lib/judge.ts:49-56` の closing プロンプトは `topic` のみ参照することを実装中に確認し、ヘルパー引数を `{ caseId, topic }` に簡略化 (オーディ LOW-001 消化)
- **パイプライン**: アーキ 2 巡 (初回はテーブル境界誤認で task.md 補強後に再実行) → ビルド → テスタ 2 巡 (両方とも UI ターン制御で 60s+ タイムアウト) → リードが spec を fast-path 書き直し (admin client + REST API 直叩き、3/3 通過 17.3s) → オーディ 3 巡 (MEDIUM-001 + LOW 4 件すべて消化、最終判定 HIGH 0 / MEDIUM 0 / LOW 1)
- **コパレビュー待ちミス**: リードが CI (Vercel pass) のみ確認してマージ。実害ゼロ (コパ指摘 0 件) だったが、過去 PR #41/#44/#45/#47 ではほぼ毎回コパが具体的指摘を出していたのに待たなかったのは規範違反。[[feedback-copilot-review]] を新規作成して運用化
- 残課題: `[LOW-001-BUG005]` (E2E ユーザー A の `api_key_encrypted=NULL` のため AI 生成経路が CI で踏まれない) を backlog に記録

#### 9. PR #50 マージ: BUG-008 useSearchParams を使う Client を Suspense 境界で包む

- 予防的修正: Next.js 16 App Router 公式ガイダンス遵守と将来の静的最適化への備え
- `app/auth/login/page.tsx` を Server Component 化し、新規 `LoginForm.tsx` (Client) を `<Suspense fallback={<LoginFormSkeleton />}>` でラップ
- `app/case/[id]/page.tsx` で既存の `<CaseRoom />` を `<Suspense fallback={<CaseRoomSkeleton />}>` でラップ。`CaseRoom.tsx` (825 行) は無変更
- Skeleton には `role="status"` / `aria-busy="true"` / `aria-live="polite"` を付与 (オーディ LOW-001 を PR 内消化)
- **パイプライン**: リード先行実装 (PR #47 と同パターン、アーキ・ビルド省略) → テスタ 14/14 通過 (CRITICAL 4 + BUG-007 4 + BUG-004 3 + BUG-005 3、54.2s) → オーディ HIGH 0 / MEDIUM 0 / LOW 1 → LOW-001 (aria 属性) を PR 内消化
- **コパレビュー**: 4.5 分待機して 0 件確認 ([[feedback-copilot-review]] 適用、PR #49 でのミスを今回は避けて規範遵守)
- backlog 整理: PR #49 で消化済みだが削除し忘れていた BUG-005 + 本タスク BUG-008 + LOW-001 を削除

#### 10. PR #51 マージ (2026-06-17): BUG-006 相手の終了提案にバナー強調 + ビープ音で通知

- 視覚 (amber 配色 + animate-pulse + role="alert") と聴覚 (Web Audio API 880Hz/0.15s sine wave、音源ファイル不要) の二系統で通知
- 通知方式 (2026-06-17 ダイチ確認): バナー強調 + 音のシンプル組み合わせ。ブラウザ通知 API / タブタイトル点滅は別タスク
- `computeEndProposalState` 純関数で render と useEffect の判定ロジック重複を解消 (オーディ LOW-002 消化)
- **パイプライン**: リード先行実装 → テスタ初回 10/10 (BUG-007 spec 9 件を task.md 指示にもかかわらず実行漏れ) → リード補完で BUG-007 spec 直接実行 9/9 通過 (合計 19/19) → オーディ LOW 2 → 初回消化試行 → コパが LOW-001 再発を catch
- **コパレビュー学び**: コパは 1 PR 1 review。修正 push しても再レビューしない (古いコメントが「修正前の位置」を指したまま残り続ける)。push 後の 4.5 分待機で「新規ゼロ」を確認するルール ([[feedback-copilot-review]]) は引き続き有効だが、push 後の追加レビューは期待しない方が良い
- **オーディ取りこぼし学び**: コパが catch した LOW-001 再発 (`prev === null` チェックの不完全実装) をオーディは見逃した。「初回マウントで `ref = false` に書き込まれる → polling で誤発火」の論理を見抜くにはオーディの抽象度が足りなかった可能性

### 未対応の残項目（PR #54 マージ後）

- **FEAT**: FEAT-004 法案 Hub
- **MON**: MON-001 課金 / MON-002 広告
- **LOW-001-BUG005**: AI キー SET 経路の E2E 動的検証が現状環境で実行されない (テスト Supabase ユーザー A の `api_key_encrypted=NULL`)
- （OPS-002 は PR #53 で対応済み。`scripts/setup-test-db.sh` 化は障壁解消済みの任意フォローアップ）

### コミット忘れ事故 2 回連続の教訓 → 即実証

PR #44 → PR #46 で 2 回連続「テスタ追加 spec + パイプラインログ」を add し忘れた。新しい feedback として [[feedback-commit-check]] に運用化。要点: パイプライン後の commit 前に必ず `git status` で untracked 確認、特に `tests/e2e/*.spec.ts` と `docs/knowledge/(test|audit)-log/*.md` は要注意。**直後の PR #47 で運用通り 1 発成功し、即実証となった**。

### 次セッション開始時の next アクション（優先順）

1. **backlog 未対応**: MON-001/002（マネタイズ、保留）のみ。FEAT も BUG も OPS も**未対応ゼロ**（FEAT-004 を PR #57 で対応済み）
2. **本番動作確認の任意フォロー**: FEAT-004 の Hub/公開/インポートが本番で動くこと（migration 適用済み、Vercel デプロイ後に手動確認すると安心）。BUG-004/007 の本番確認も未実施
3. **任意フォローアップ**: テスト DB の定期リセット機能（`setup-test-db.sh --reset` 相当、public drop/recreate + grant 復元。e2e-test-db.md 残課題）/ `setup-test-db.sh`・`run_migrations` に `NOTIFY pgrst` 組み込み（下記知見）/ test DB の cases 蓄積掃除

### 今セッションで学習した運用パターン（恒久知識）

- **Supabase RLS の自己/相互参照は無限再帰 (42P17)**: ポリシーの USING 式が RLS 配下のテーブルをサブクエリ参照すると、サブクエリにも RLS が適用されて無限再帰し `infinite recursion detected in policy` で SELECT が全滅する（FEAT-004 で laws の `EXISTS(law_members)` 経由で露見）。**定石の修正は SECURITY DEFINER 関数（RLS バイパス）に判定を切り出す**。さらに**その関数は `public` でなく `private` 等の非公開スキーマに置く**（public だと PostgREST が `/rest/v1/rpc/...` として認証ユーザーに露出し、関係の boolean オラクルになる）。`GRANT USAGE ON SCHEMA private + EXECUTE TO authenticated`、`REVOKE EXECUTE FROM PUBLIC` も付ける。FEAT-004 PR #57 で `private.is_law_member`/`is_law_owner` を実装
- **Management API 直 SQL で migration を当てると PostgREST スキーマキャッシュが古いまま**: 新カラム（例 `laws.is_public`）を含む `select()` が REST 経由で「column does not exist」扱いになり、`maybeSingle()` が null を返して画面が notFound に倒れる。**migration 末尾に `NOTIFY pgrst, 'reload schema';` を入れる**か、適用後に手動 NOTIFY する。FEAT-004 のデバッグで丸半日級にハマった主因。`setup-test-db.sh`/`run_migrations` への組込みは未対応（任意フォロー）
- **本番 DB への migration 適用手順（FEAT-004 PR #57 で実施）**: マージ後、`.env.local` を `set -a; source` し、**`SUPABASE_PROJECT_REF == nhcsshqcyprbitfctyio`（本番）をガード**してから Management API で migration を順に適用。`.env.local` は読むだけ（`vercel link`/`vercel env pull` は `.env.local` を上書きする事故経路なので使わない）。適用後に列・ポリシー・RPC 封鎖・PostgREST 反映を検証。`applied.txt` に追記して commit（次回 run_migrations の二重適用防止）
- **手動 dev:test サーバはオーファンで詰まる**: `npm run dev:test` を kill しても子の `next-server` が port 3000 を掴んだまま残り、次の起動が EADDRINUSE で `終了 1` になりつつ古いサーバが応答してフレークの温床になる。**`for p in $(lsof -ti:3000); do kill "$p"; done` で確実に掃除**してから起動する。`pkill -f "next dev"` は Claude のシェルまで巻き込んで `exit 144` になるので使わない。サーバとテストを**同一 Bash コマンド内**で動かすと安定
- **agents.sh の run_migrations は env 任せで本番ガードなし**: `engineer`/`tester` 実行時に `run_migrations` が走り、その時の `SUPABASE_*` env が指す DB へ適用する。`.env.local`（本番）を source した状態で agents.sh を起動すると本番に当たり得る。テスト目的では `.env.test` を source してから起動する（env 未設定だと「未設定」エラーでフェイルセーフ）
- **laws 系 E2E (laws.spec.ts L02-L04) は A-B の accepted フレンド関係が前提**: 未設定だと InvitePanel に B が出ず招待ボタン未検出で失敗。test DB に `friend_requests(A,B,'accepted')` を 1 行投入する（e2e-test-db.md に明記済み）
- **コパは 1 PR 1 review、push 後の再レビューはしない**: PR #51 で発覚。初回 push 時にコパが残したインライン指摘を消化して push しても、コパは新規 review を残さない (CI は再実行される)。古いインラインコメントは「修正前の行位置」を指したまま残り続ける。push 後の 4.5 分待機ルール ([[feedback-copilot-review]]) は新規 PR の初回レビュー確認用と理解する
- **オーディは「初回マウント時の ref 初期化」のような状態遷移バグを取り逃すことがある**: BUG-006 PR #51 で `prevIsOpponentEndProposalRef = useRef(false)` の初回 false 書き込みで polling 取得時に誤発火するバグをオーディは見抜けず、コパが catch。状態遷移系のバグは「複数 render の連鎖」を頭でシミュレートしないと見えない場合がある
- **テスタは task.md の必須項目を見落とすことがある (BUG-007 spec パターン)**: BUG-005 PR #49 / BUG-006 PR #51 で 2 度連続、task.md L88-89 で「BUG-007 spec の実行」を明記したのに 9 件を実行から落とした。リードが補完で `npx playwright test tests/e2e/auth-login.spec.ts tests/e2e/middleware-next.spec.ts` を直接実行して 9/9 確認するパターンが定着
- **コパレビュー待ちは明示確認すべき**: CI 通過だけでマージするのは規範違反。`gh api repos/.../pulls/N/{comments,reviews}` でコパ反応をチェック、最低 3-5 分待つ。BUG-005 PR #49 で待たずマージして実害なしだったが規範違反 → [[feedback-copilot-review]] で運用化
- **パイプライン中の `tsconfig.json` 自動書き換え**: Next.js dev サーバ起動時に `tsconfig.json` の `include` に `.next/dev/dev/types/**/*.ts` が自動追記される。BUG-005 セッションで毎回再現したため、テスタ後の commit 前に `git restore tsconfig.json` で都度 revert する運用が定着
- **テスタの能力限界 (UI ターン制御)**: 複数ラウンド消化を `page.reload()` + `waitForSelector` ループで再現すると 60s+ タイムアウトに陥りやすい。BUG-005 でテスタが 2 回連続失敗 → リードが admin client (DB 直接 INSERT) + REST API 直叩き (`page.context().request.post`) の fast-path に書き直して 4-5s で完走。今後の複雑な状態遷移 spec は最初から fast-path で書く方針
- **`scripts/agents.sh:149` のブランチ命名はハードコード**: `feature/$(date +%Y%m%d-%H%M%S)` 形式で固定。task.md でブランチ名を指定しても無視される (BUG-005 PR #49 で発覚)
- **Vercel CLI の `vercel link` は `.env.local` を上書きしうる**: 内部で `vercel env pull` が自動実行され、Vercel に登録された env vars で `.env.local` が書き換えられる。**Vercel の `sensitive` type は読み取り API で値を返さない仕様**のため、復旧経路がなく事故になる。`vercel link` 前に `.env.local` をバックアップする運用が必須
- **Supabase の Personal Access Token は project スコープを持つ**: 本番 project と test project で別 token が要るケースがある（家庭裁判所では実際にそうだった）
- **`new URL(path, origin)` ベースの open redirect ガード**: `startsWith("/") && !startsWith("//")` だけでは backslash バイパス（`/\evil.com`）や `%2f` 経路を素通しさせる。`new URL(rawNext, window.location.origin)` で URL パーサに委ね `u.origin === window.location.origin` を強制すると、backslash 正規化や `javascript:` スキームや protocol-relative URL 全部に効く防御になる
- **オーディは git tracking 状態まで見る**: 単にコードを読むだけでなく `git status` と HEAD の照合で「コミット忘れ」「untracked spec」を catch する [[feedback-commit-check]]
- **テスタが書く新規 spec は untracked 状態で残る**: パイプライン後の commit で `git add tests/e2e/*.spec.ts` を明示しないと取りこぼす
- **`./temp/` は gitignored ではない**: ダイチが秘密情報の一時保管に `./temp/` を使うことがあるが、`.gitignore` で除外されていないので `?? temp/` として git status に出る。即削除する運用 or `.gitignore` 追加が必要
- **Vercel REST API による env vars 操作**: `POST /v10/projects/{id}/env`（新規追加）、`PATCH /v10/projects/{id}/env/{envId}`（target 変更）、`DELETE /v9/projects/{id}/env/{envId}`（削除）。`decrypt=true` クエリも sensitive 値には効かない（API レベルで返さない）
- **Vercel の Preview scope env vars**: 同じ key を target=preview と target=production で別値登録できる。PATCH で target を絞れば「片方の scope から外す」が可能

### マージ済み PR（このセッション）

- **PR #41** (2026-06-13): FEAT-006 チャット回数柔軟化 + 固定挨拶（オーディ MEDIUM/LOW 5 件 + コパ 7 件消化）
- **PR #42** (2026-06-13): OPS-003 Preview DB 分離（`.env.local` 復旧含む大事故セッション）
- **PR #43** (2026-06-13): BUG-007 backlog 追加
- **PR #44** (2026-06-15): BUG-007 修正（初パイプライン経験、open redirect 防御）
- **PR #45** (2026-06-15): BUG-004 修正（パイプライン経由、コミット忘れ → PR #46 で補修）
- **PR #46** (2026-06-15): BUG-004 の漏れ補修（spec + パイプラインログ）
- **PR #47** (2026-06-15): middleware の `?next=` 付与（BUG-007 残宿題回収、`feedback_commit_check` 運用化直後の 1 発成功）
- **`1e2d3c4`** (2026-06-15): memory 更新 main 直 commit（PR なし、`./memory` 個人用ディレクトリ運用）
- **`c97f371`** (2026-06-15): memory に PR #47 + `1e2d3c4` の追記を main 直 commit
- **PR #48** (2026-06-15): backlog 11 PR 分の対応済み整理 + OPS-001 完了反映 (`-107 +12`)
- **PR #49** (2026-06-15): BUG-005 AI 閉廷宣告の発火位置を `phase=judging` 遷移時へ移動。実装 + spec + design.md で `+1548 -538`、パイプライン 3 巡 + LOW 消化 2 回、コパ待たずマージ (実害ゼロ → [[feedback-copilot-review]] 化)
- **PR #50** (2026-06-15): BUG-008 useSearchParams を Suspense 境界で包む。リード先行実装 + テスタ 14/14 + オーディ LOW 1 (aria 属性、PR 内消化) + コパ 4.5 分待機ゼロ件マージ。backlog から BUG-005/008/LOW-001 を削除し未対応 6 件に整理
- **PR #51** (2026-06-17): BUG-006 終了提案にバナー強調 + ビープ音通知。Web Audio API で音源ファイル追加なし。`computeEndProposalState` で render/effect 重複解消 (LOW-002 消化)。コパが初回 LOW-001 消化の不完全 (ref 初期 false 書き込みでの誤発火) を catch、PR 内消化
- **PR #52** (2026-06-18): backlog ドリフト整理。BUG-006 を未対応から削除 + PR #49/#50/#51 を対応済みテーブルへ追記。docs のみコパ 0 件マージ
- **PR #53** (2026-06-18): OPS-002 migration 冪等化。schema.sql と二重定義の 3 ファイルを `DROP POLICY IF EXISTS` / `ADD COLUMN IF NOT EXISTS` 化。populated test DB への再適用で冪等性実証 (`+16 -9`)。approach B 採用、本番 introspection 不要
- **PR #54** (2026-06-18): backlog の OPS-002 を対応済みへ移管 (PR #53 反映)。docs のみコパ 0 件マージ
- **PR #55** (2026-06-18): `scripts/setup-test-db.sh` でテスト DB セットアップ自動化。Management API 経由で schema.sql → migrations 一括適用、本番 ref ブロック + 既初期化 preflight + --dry-run。コパ LOW 4 件を PR 内消化 (`+138 -2`)
- **PR #56** (2026-06-18): LOW-001-BUG005 api_key SET 経路の E2E 動的検証。`lib/judge.ts` に TEST_MODE モック分岐（本番ガード付き）、spec に BUG-005-4（専用 ephemeral plaintiff で隔離検証）。コパ 5 件 PR 内消化 (`+176 -9`)。bug005 4/4 通過
- **PR #57** (2026-06-18): FEAT-004 法案 Hub（公開・インポート）+ laws RLS 無限再帰の恒久修正（SECURITY DEFINER 関数を private スキーマ化）。フルパイプライン、オーディ 3 + コパ 5 件消化。feat004 3/3 + laws 4/4。本番 DB へ 2 migration 適用済み
- **PR #58** (2026-06-18): applied.txt に FEAT-004 本番適用記録 + backlog 対応済み反映（docs のみ）

### 環境・ツール状態（2026-06-15 時点）

- OS: Ubuntu。tailscale + termius SSH from スマホ + tmux でセッション保持
- node: nvm v24.16.0、Next.js 16.2.6 の `engines.node >=20.9.0` を満たす
- claude: ネイティブビルド `~/.local/bin/claude`（node 非依存）
- **Vercel CLI**: 54.13.0 グローバルインストール済み。`vercel login` / `vercel link` 完了済み。プロジェクト ID = `prj_uKsjj2tpZiJDRVrMw2SqmSZ8ccy2`、team ID = `team_Dj2KiQxEAnQWkHHK1RNqJ59g`
- Playwright: chromium 導入済み
- テスト Supabase: `eckrccrfnblzdbflnssf` 完全稼働、auth config も本番ベース（mailer_autoconfirm=false, SMTP=Gmail）に整備済み
- 本番 Supabase: `nhcsshqcyprbitfctyio`、cases は空（FEAT-006 で旧データ削除済み）、profiles は 5 件残置
- E2E ターゲット: `.env.local`（本番）↔ `.env.test`（テスト）の env スイッチ + Vercel Preview の env scope 分離で 3 環境完全独立
- gh CLI: `itoemon` 認証済み
- lint baseline: 0 errors（継続維持）

---

## 旧セッション要約（2026-05-30 〜 2026-06-02）

### 2026-05-30: claude CLI ネイティブ移行

- `claude` を npm 版 → ネイティブビルド (`~/.local/bin/claude`、node 非依存、ELF) へ完全移行
- **効果**: claude が node18 に pin されなくなり、子プロセスへの node18 強制が消滅。Next.js 16 の E2E が素で回るようになり、後の PR #30 で `scripts/agents.sh` の PATH サニタイズ細工と `package.json` の `volta.node` pin が撤去された

### 2026-06-02 マージ済み PR

- **PR #30**: volta 痕跡撤去（要件は `engines.node: ">=20.9.0"` で表明、`scripts/agents.sh` の `start_dev_server` は素の `setsid bash -c "npm run dev"` に簡素化、停止側 PGID 特定ロジックは残置）
- **PR #31** (FEAT-RESP-HEADER): ヘッダーをアバター起点のドロップダウンメニュー方式へ刷新（全画面サイズ同一 UI、breakpoint 不使用、`role="menu"` / `aria-expanded` 完備、Server/Client 分割で機微情報非送出、`profiles` 取得は `.maybeSingle()`）
- **PR #32** (FEAT-005): マイページ `/me` を新設（GitHub/Linear 型 4 セクション、ダイジェスト N=5、`Promise.allSettled` でセクション単位フォールバック、profiles 跨ぎ admin の carve-out を維持、middleware の `PROTECTED_PATH_PREFIXES` に追加）
- **PR #33** (LOW-001/002): 監査由来 LOW 2 件を対応済みへ移管（package.json リネーム経緯 README 明示 / `@upstash/core-analytics` 外部送信不可の 3 段検証）
- **PR #34**: BUG-002 / BUG-003 backlog 追加（バグ修正 BUG セクション新設）

### 旧セッションで確立した恒久知識（後セッションで適用済み）

- **コパ指摘パターンの先回り回避**: テスト品質の落とし穴（`page: any` / `toBeGreaterThanOrEqual(0)` / `expect(... || true).toBe(true)` / `waitForURL('/')` の中間マッチ / `isVisible().catch(() => false)` / `page.context()` でステータス見ない）を spec 書く前に意識する。`import { type Page }` で `page: Page` 型化、hard assertion、`Response.status()` で 5xx チェック
- **オーディ指摘の PR 内自己修正**: LOW で 1-3 行差分なら PR 内自己修正してマージ前に消化する方が筋（PR #27 以来）。backlog に自動追記された分は削除して整理する
- **コパ指摘のスコープ整合**: 書類整合（docs と code の対応関係、対応済み/未対応の重複記載）も本筋。コードを変えなくても docs 側を揃える
- **PR 1 本のコパインライン件数の目安**: 実装が綺麗だと 0-3 件、テストが緩いと 8-11 件
- **Tailwind 4 oxide native binding 欠落の症状再発時の対処**: `@tailwindcss/oxide-linux-x64-gnu` が npm optionalDependencies バグで欠落して dev サーバが 500 を返す場合、`rm -rf node_modules .next && npm install` でフルクリーン復旧

---

## 覚えておくべき判断・経緯（恒久知識）

- **パイプライン運用**: リードが `./scripts/agents.sh architect|engineer|tester|auditor` を Bash から自走させる（[[feedback-pipeline-runner]]）。task.md（最優先）→ requirements.md をアーキが読む。engineer がブランチを切る。auditor は HIGH 0 件 & 合計5件以下で通過、未修正 MEDIUM/LOW は backlog に自動追記。長時間処理は `run_in_background: true` で。
- **マイグレーション適用**: `supabase_execute`（Supabase Management API・`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`）経由。`run_migrations` が `applied.txt` で適用済み管理。applied.txt は実 DB と乖離しうるので過信しない（実態は `pg_policies` 等で直接照会）。
- **`design.md` は永続資料**: 既存セクション削除禁止・末尾追記のみ（[[feedback-design-md]]）。
- guest_tokens は RLS 有効だがポリシーなし（Service Role のみ）。`expires_at` はアプリ側 ISO 計算。ゲスト参加 API はトークン発行を cases UPDATE より先に。
- middleware の保護パスは `pathname === "/"`（完全一致）+ `pathname === "/case/new"` + `PROTECTED_PATH_PREFIXES = ["/history", "/profile", "/friends", "/laws", "/me"]`（前方一致）。`?next=` 付与は PR #47 で実装済み。
- 配色: 被告/エラー=`rose-*`、弁護人AI=`teal-*`、プライマリ=`brand-700/800`（`brand-500` は WCAG 非対応で不使用）。
- `search_users` は `SECURITY DEFINER`。`friend_requests` の UNIQUE INDEX は `(LEAST,GREATEST)` で双方向重複ブロック。拒否=レコード削除。
- **SMTP は Gmail SMTP**（500通/日、アプリパスワード）。サインアップ `emailRedirectTo` は `new URL('/auth/callback', NEXT_PUBLIC_SITE_URL)`、未設定時は `window.location.origin` フォールバック（PR #42 で導入）。
- **API パスパラメータの UUID 検証**: `lib/text-utils.ts` の `isUuid()` を各メソッドハンドラ先頭（認証/ゲスト分岐より前・DB アクセス前）で通す（PR #27 で全15ルート対応済み）。
- **profiles 跨ぎ admin の carve-out**: MEDIUM-001 由来で許容される唯一の admin 利用。**自分の ID 集合経由でのみ admin で profiles を取得**（他者の任意 ID で admin を呼ばない）。`/me` の FriendsCard が代表例。
- `gh pr edit` は古い projects classic API で失敗 → PR body 更新は `gh api -X PATCH /repos/itoemon/family_court/pulls/N -f body=...`。
- Claude Code Bash ツールは毎回独立シェル。`.claude/settings.local.json` は次回起動時から有効。

### マージ済み PR（累計・抜粋）

- PR #12〜#28: 初期整備（middleware 保護パス・guest tokens HMAC→nonce・igiari リネーム・FEAT-002 プロフィール/フレンド・MEDIUM-001 レートリミット・FEAT-003 法律作成・BUG-001 確認メール・トークン可視化・MEDIUM-001 RLS 二層防御・UUID 共通化）
- PR #29: OPS-001 Part1 パイプライン tester node20 化
- PR #30-#34 (2026-06-02): volta 痕跡撤去 / FEAT-RESP-HEADER / FEAT-005 マイページ / LOW-001-002 移管 / BUG-002-003 追加
- PR #35-#40 (2026-06-03〜06-12): BUG-003 説得力スコア / BUG-002 過去ケース判決画面 / OPS-001 Part 2 env スイッチ / chore lint / chore spec hard assertion / feat ui error.tsx
- PR #41-#51 (2026-06-13〜06-17): FEAT-006 / OPS-003 / BUG-007 backlog / BUG-007 修正 / BUG-004 修正 / BUG-004 補修 / middleware ?next= / backlog 整理 / BUG-005 閉廷アナウンス / BUG-008 Suspense 境界 / BUG-006 終了提案通知
- PR #52-#58 (2026-06-18): backlog 整理 / OPS-002 冪等化 / OPS-002 移管 / setup-test-db.sh / LOW-001-BUG005 / FEAT-004 法案 Hub + RLS 再帰修正 / FEAT-004 bookkeeping
