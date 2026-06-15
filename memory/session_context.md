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

## 最終更新: 2026-06-15（FEAT-006 + OPS-003 + BUG-007/004 + middleware ?next= で PR 7 本マージ + memory main 直 commit + backlog 整理 PR #48 + BUG-005 PR #49 + BUG-008 PR #50）

### 現在のブランチ・PR 状態

- 現ブランチ: `main`（クリーン、HEAD `9149a7a` = PR #50 マージ後）
- オープン PR: なし
- 本セッションでマージした PR: #41, #42, #43, #44, #45, #46, #47, #48, #49, #50

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

### 未対応の残項目（PR #50 マージ後）

- **FEAT**: FEAT-004 法案 Hub
- **OPS**: OPS-002 スキーマ整合性
- **BUG**: BUG-006 終了提案通知
- **MON**: MON-001 課金 / MON-002 広告
- **LOW-001-BUG005**: AI キー SET 経路の E2E 動的検証が現状環境で実行されない (テスト Supabase ユーザー A の `api_key_encrypted=NULL`)

### コミット忘れ事故 2 回連続の教訓 → 即実証

PR #44 → PR #46 で 2 回連続「テスタ追加 spec + パイプラインログ」を add し忘れた。新しい feedback として [[feedback-commit-check]] に運用化。要点: パイプライン後の commit 前に必ず `git status` で untracked 確認、特に `tests/e2e/*.spec.ts` と `docs/knowledge/(test|audit)-log/*.md` は要注意。**直後の PR #47 で運用通り 1 発成功し、即実証となった**。

### 次セッション開始時の next アクション（優先順）

1. **backlog 未対応の中から**: BUG-005（閉廷アナウンス条件）/ BUG-006（終了提案通知）/ BUG-008（useSearchParams Suspense 境界）/ OPS-002（test DB スキーマ整合性）/ FEAT-004（法案 Hub）/ MON-001/002（マネタイズ、保留）
2. **本番動作確認** の任意フォローアップ: BUG-004 / BUG-007 の修正が本番でも動くこと（preview は通過済み）

### 今セッションで学習した運用パターン（恒久知識）

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
- PR #41-#50 (2026-06-13〜06-15): FEAT-006 / OPS-003 / BUG-007 backlog / BUG-007 修正 / BUG-004 修正 / BUG-004 補修 / middleware ?next= / backlog 整理 / BUG-005 閉廷アナウンス / BUG-008 Suspense 境界
