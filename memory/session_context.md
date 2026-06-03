---
name: session-context
description: リードの直近セッションの要約。新しいチャットを開いたときに会話の文脈を引き継ぐために使う
metadata:
  type: project
---

# セッション引き継ぎ

新しいチャットを開いたら、リードはこのファイルを読んで前回の状況を把握する。
**更新タイミング**: ダイチが「セッションを乗り換える」「session_context を更新して」と明示したときのみ ([[feedback-session-context]] 参照)。

---

## 最終更新: 2026-06-02（PR 5 本マージ。ヘッダー刷新・マイページ新設・LOW バッチ整理・BUG バックログ追加）

### 現在のブランチ・PR 状態

- 現ブランチ: `main`（クリーン、`bec4e8e` HEAD）
- オープン PR: なし

### このセッション (2026-06-02) でやったこと

#### 1. PR #30 マージ: volta 痕跡撤去
- 前セッション (2026-05-30) で claude をネイティブ版へ移行したため、`scripts/agents.sh` の PATH サニタイズと `package.json` の `volta.node` pin を撤去。
- 要件は `engines.node: ">=20.9.0"` で表明する形へ切り替え。
- `stop_dev_server` の PGID 特定ロジックとテスタの判定ロジックは本筋なので残置。

#### 2. PR #31 マージ: FEAT-RESP-HEADER ヘッダー刷新
- ダイチからの要望「ヘッダーがスマホビューで綺麗じゃない」に対応。
- **全画面サイズで同一 UI**（breakpoint 不使用、プロジェクト全体の `sm:/md:/lg:` 0 件運用を維持）。
- ロゴ + アバター（profiles.avatar_url、未設定は人型アイコン）の 2 要素のみ。
- アバタークリック → ドロップダウン（外側クリック・Escape クローズ、`role="menu"` / `aria-expanded` / `aria-controls={isOpen ? menuId : undefined}` の ARIA 完備、`<form role="none">` で WAI-ARIA メニュー構造に整合）。
- 認証時: 過去のケース / フレンド / プロフィール / 区切り / ログアウト。未認証時: ログイン / サインアップ。
- `Header.tsx` (Server) + `HeaderUserMenu.tsx` (Client) に分割、Props は `isAuthenticated`/`avatarUrl`/`displayName` のみ（機微情報非送出）。
- `profiles` 取得は `.maybeSingle()`（0 rows 時の error 生成回避、既存慣習に整合）。

#### 3. PR #32 マージ: FEAT-005 マイページ新設
- URL: `/me`、middleware の `PROTECTED_PATH_PREFIXES` に追加。
- 構成: ヘッダー部 + 4 セクションカード（プロフィール / フレンド / 過去のケース / 参加中の法律）。GitHub・Linear 型デザイン、stone/brand トーン、breakpoint なし。
- ダイジェスト件数 **N=5**、`defense_custom_instruction` サマリ 100 文字 truncate。
- `Promise.allSettled` で 5 系統クエリ並列発行、`settledValue` ヘルパーでセクション単位フォールバック（取得失敗で 500 にしない）。
- **profiles 跨ぎ admin の carve-out** を維持（フレンド表示名/アバターのみ、friend_requests 経由で取得した自分のフレンド ID 集合・最大 5 件・accepted のみが対象）。それ以外は `createSessionClient`。
- 既存ページ `/profile`・`/friends`・`/history`・`/laws` は無変更、マイページは読み取り専用ダイジェスト + ディープリンクに責務限定（form ゼロ、Server Action ゼロ）。
- ヘッダードロップダウン認証時メニュー先頭に「マイページ」リンクを追加。
- LawsCard で `lawsTotalCount` は memberships と pendingInvitations の**両方成功時のみ**計算（片方失敗時はバッジ非表示で他セクションと整合）。法律のソートは `b.sortKey.localeCompare(a.sortKey)` の降順（比較関数の推移性遵守）。

#### 4. PR #33 マージ: LOW-001 / LOW-002 対応済みへ移管
- **LOW-001**（package.json name 変更ログ未記載）: README.md に「旧名 family_court、PR #17 でリネーム、GitHub リポジトリ URL は family_court のまま、Vercel と package.json は igiari」と明示。追跡性回復のみ、コード変更なし。
- **LOW-002**（@upstash/core-analytics 外部送信検証）: 3 段検証（ratelimit ソース確認・`if (this.analytics)` ガード確認・`npm run build` 後のバンドル grep）で「ユーザー識別子の外部送信は発生しない」を確定。`analytics: false` のとき Analytics クラスは未インスタンス化、record/ingest 実行経路なし、バンドルにコードは含まれるが動作経路なし。
- 検証根拠は `docs/backlog.md` の対応済みリストに残置（コミット履歴と合わせて再現性のある根拠）。
- バックログから監査由来の LOW 項目は完全に消化された（現在ゼロ）。

#### 5. PR #34 マージ: BUG-002 / BUG-003 バックログ追加
- **BUG-002**: 過去のケース表示時、チャット画面が一瞬表示されてから判決画面へ自動遷移する挙動を解消し、判決確定済みケースを開いた時点から判決画面を直接表示する（`/case/[id]/page.tsx` の SSR 側 phase 判定見直し想定）。
- **BUG-003**: 判決画面の説得力スコアが**常に 0% または空で表示される**現象を修正する。着手時に計算ロジック（API 側）と表示側（判決画面コンポーネント）の切り分けが必要。
- 新規セクション「バグ修正（BUG）」を「監査由来の品質改善」と「マネタイズ」の間に追加。

### 次のアクション（優先順）

1. **BUG-002**（中規模・想定 1-2 時間）: 過去のケース表示の直接判決画面遷移。`/case/[id]/page.tsx` の SSR phase 判定で直接出すか、`/case/[id]/verdict` 等への Server Redirect で振り分ける設計検討。
2. **BUG-003**（要調査）: 説得力スコアが 0%/空。dev サーバ起動 → 再現確認 → 計算 (API) と表示の切り分け、から始める。中身次第で軽くも重くもなる。
3. **OPS-001 Part2**（中規模・地味）: E2E ターゲット DB を本番から切り離す。テスト用 Supabase プロジェクト + `.env.test`、またはシード&クリーンアップ戦略の設計。
4. **FEAT-004 法案 Hub** / **MON-001 課金** / **MON-002 広告**（大物 or 低優先）。

### 今セッションで学習した運用パターン（恒久知識）

- **コパ指摘パターンの先回り回避**: PR #31 で 11 件指摘された「テスト品質の落とし穴」(`page: any` / `toBeGreaterThanOrEqual(0)` / `expect(... || true).toBe(true)` / `waitForURL('/')` の中間マッチ / `isVisible().catch(() => false)` の弱い assertion / `page.context()` でステータス見ない) を以降の spec で先回り修正できるよう、ビルド/テスタ完了後にぼくが spec をスキャンして同パターンが入っていないかチェックする運用が有効。次回 spec を書くときも `import { type Page }` で `page: Page` 型化、hard assertion、`Response.status()` で 5xx チェック、を意識する。
- **オーディ指摘の PR 内自己修正**: LOW で 1-3 行差分なら PR 内自己修正してマージ前に消化する方が筋（PR #27 以来の慣例）。backlog に追記して別 PR にする必要なし。オーディが backlog に自動追記した分は削除して整理する。
- **コパ指摘のスコープ整合**: PR #30 の「volta 痕跡が docs に残ってる」指摘や PR #33 の「対応済みと未対応に同 ID 二重記載」指摘のように、書類整合は本筋。コードを変えなくても docs 側を必ず揃える。
- **PR 1 本のコパインライン件数の目安**: 実装が綺麗だと 0-3 件、テストが緩いと 8-11 件出る。テスト spec のレビューはコパが特に厳しい。

### 環境・ツール状態（2026-06-02 時点）

- OS: Ubuntu。tailscale + termius SSH from スマホ + tmux でセッション保持。
- node: nvm v24.16.0。Next.js 16.2.6 の `engines.node >=20.9.0` を満たす。`package.json` の volta pin は撤去済み。
- claude: ネイティブビルド `~/.local/bin/claude`（node 非依存、`installMethod: "native"`）。
- Playwright: chromium 導入済み（`~/.cache/ms-playwright`）。E2E ターゲットは依然**本番 Supabase**（OPS-001 Part2 未対応）。
- gh CLI: `itoemon` 認証済み。承認スキップ: `.claude/settings.local.json`（bypassPermissions）。
- Tailwind 4 (`@tailwindcss/oxide-linux-x64-gnu` native binding): 2026-06-02 のテスタ初回実行時に npm optionalDependencies バグで欠落し dev サーバが 500 を返した。`rm -rf node_modules .next && npm install` で復旧。**症状再発時の対処**: 同じくフルクリーン → npm install。

---

## 旧最終更新: 2026-05-30（claude をネイティブ版へ移行 = node/volta 根本解決）

### このセッション(2026-05-30)でやったこと

- **claude CLI を npm版 → ネイティブビルドへ完全移行**。
  - 削除: volta pin の npm版（`volta uninstall @anthropic-ai/claude-code`）＋ nvm(node24) の孤立 npm global（`claude.exe` 実体 239MB ＋空スコープdir を `rm`）。
  - 再インストール: `claude install stable` → `~/.local/bin/claude`（ELF ネイティブ・node 非依存、ver 2.1.149）。
  - PATH: `~/.bashrc` 末尾に `export PATH="$HOME/.local/bin:$PATH"` を追記。
  - **効果**: claude が node18 に pin されなくなり、子プロセスへの node18 強制が消滅 → Next.js 16 の E2E が素で回る。`scripts/agents.sh` の PATH サニタイズ細工は不要化（**2026-06-02 PR #30 で撤去済み**）。

---

## 覚えておくべき判断・経緯（恒久知識）

- **パイプライン運用**: リードが `./scripts/agents.sh architect|engineer|tester|auditor` を Bash から自走させる（[[feedback-pipeline-runner]]）。task.md（最優先）→ requirements.md をアーキが読む。engineer がブランチを切る。auditor は HIGH 0 件 & 合計5件以下で通過、未修正 MEDIUM/LOW は backlog に自動追記。長時間処理は `run_in_background: true` で。
- **マイグレーション適用**: `supabase_execute`（Supabase Management API・`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`）経由。`run_migrations` が `applied.txt` で適用済み管理。applied.txt は実 DB と乖離しうるので過信しない（実態は `pg_policies` 等で直接照会）。
- **`design.md` は永続資料**: 既存セクション削除禁止・末尾追記のみ（[[feedback-design-md]]）。
- guest_tokens は RLS 有効だがポリシーなし（Service Role のみ）。`expires_at` はアプリ側 ISO 計算。ゲスト参加 API はトークン発行を cases UPDATE より先に。
- middleware の保護パスは `pathname === "/"`（完全一致）+ `pathname === "/case/new"` + `PROTECTED_PATH_PREFIXES = ["/history", "/profile", "/friends", "/laws", "/me"]`（前方一致）。
- 配色: 被告/エラー=`rose-*`、弁護人AI=`teal-*`、プライマリ=`brand-700/800`（`brand-500` は WCAG 非対応で不使用）。
- `search_users` は `SECURITY DEFINER`。`friend_requests` の UNIQUE INDEX は `(LEAST,GREATEST)` で双方向重複ブロック。拒否=レコード削除。
- **SMTP は Gmail SMTP**（500通/日、アプリパスワード）。サインアップ `emailRedirectTo` は `new URL('/auth/callback', NEXT_PUBLIC_SITE_URL)`、未設定時は中断。
- **API パスパラメータの UUID 検証**: `lib/text-utils.ts` の `isUuid()` を各メソッドハンドラ先頭（認証/ゲスト分岐より前・DB アクセス前）で通す（PR #27 で全15ルート対応済み）。
- **profiles 跨ぎ admin の carve-out**: MEDIUM-001 由来で許容される唯一の admin 利用。**自分の ID 集合経由でのみ admin で profiles を取得**（他者の任意 ID で admin を呼ばない）。`/me` の FriendsCard が代表例。
- `gh pr edit` は古い projects classic API で失敗 → PR body 更新は `gh api -X PATCH /repos/itoemon/family_court/pulls/N -f body=...`。
- Claude Code Bash ツールは毎回独立シェル。`.claude/settings.local.json` は次回起動時から有効。

### マージ済み PR（累計・抜粋）

- PR #19: FEAT-002-p1 プロフィール / PR #20: FEAT-002-p2 フレンド / PR #21: MEDIUM-001 検索レートリミット
- PR #22: FEAT-003 法律作成 / PR #23: BUG-001 確認メール / PR #24: トークン可視化・ログローテ / PR #25: backlog 整理
- PR #26: MEDIUM-001 RLS 二層防御 / PR #27: LOW-001/002 UUID 共通化 + fetch ステータス検査 / PR #28: backlog 整理
- PR #29: OPS-001 Part1 パイプライン tester node20 化
- **PR #30** (2026-06-02): volta 痕跡撤去・`engines.node` 明示
- **PR #31** (2026-06-02): FEAT-RESP-HEADER ヘッダーアバタードロップダウン刷新
- **PR #32** (2026-06-02): FEAT-005 マイページ `/me` 新設
- **PR #33** (2026-06-02): LOW-001/002 対応済み移管
- **PR #34** (2026-06-02): BUG-002/003 バックログ追加
