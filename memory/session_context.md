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

## 最終更新: 2026-05-30（claude をネイティブ版へ移行 = node/volta 根本解決）

### このセッション(2026-05-30)でやったこと

- **claude CLI を npm版 → ネイティブビルドへ完全移行**（下記「node/volta の経緯」の根本原因を解消）。
  - 削除: volta pin の npm版（`volta uninstall @anthropic-ai/claude-code`）＋ nvm(node24) の孤立 npm global（`claude.exe` 実体 239MB ＋空スコープdir を `rm`）。npm/volta 痕跡ゼロを確認。
  - 再インストール: `claude install stable` → `~/.local/bin/claude`（ELF ネイティブ・**node 非依存**、ver 2.1.149）。`installMethod: "native"`。
  - PATH: `~/.bashrc` 末尾に `export PATH="$HOME/.local/bin:$PATH"` を追記（volta/nvm より優先）。
  - **効果**: claude が node18 に pin されなくなり、子プロセスへの node18 強制（`_VOLTA_TOOL_RECURSION`）が消滅 → Next.js 16 の E2E が素で回る。`scripts/agents.sh` の PATH サニタイズ細工は**不要化**（残置は無害。撤去するなら別 PR で）。
  - ⚠️ このセッションは旧 node18 バイナリのままメモリ動作中。**ダイチが claude を再起動した後**からネイティブ版有効。

---

## 旧最終更新: 2026-05-29（env 復旧・MEDIUM-001 完了・LOW バッチ・OPS-001 Part1）

### 現在のブランチ・PR 状態

- 現ブランチ: `chore/ops001-e2e-node-orchestration`（push 済み）
- main HEAD: `9ce27e0 chore(backlog): 継続指摘 LOW 2件を対応済みへ（PR #27 で解消）(#28)`

#### オープン PR

- **PR #29** (`chore/ops001-e2e-node-orchestration`) — chore(OPS-001): パイプライン tester を node20 で E2E 実行できるよう改修（Part1）
  - `MERGEABLE`。コパレビュー待ち。ツール/ドキュメントのみ（アプリコード不変）
  - **マージ可否はダイチ判断**。次セッションでコパ対応 → マージするとよい

### このセッションでやったこと（2026-05-29）

セッション開始時、`env.local` が無くて Supabase マイグレーションが流せない状態だった。ダイチが env を追加 → そこから一気に片付けた。

1. **env 復旧**: `env.local`（ドット無し）を `.env.local` にリネーム。`.gitignore` は `.env*` で既にカバー済み（ドット無しはマッチしてなかった）。シークレットの履歴混入なしを確認
2. **MEDIUM-001 マイグレーション本番適用 + PR #26 マージ**:
   - `20260528000000_medium001_laws_select_invitee.sql` を Supabase Management API 経由で本番適用（旧 `laws_select_member` → 新 `laws_select_member_or_invitee`、`pg_policies` で検証）
   - `applied.txt` が実 DB と乖離していた（記載漏れ5件）→ 実態に同期（全11件）
   - コパ指摘（PR 本文が「未適用前提」で古い）対応 → 本文を「適用済み」に更新・返信。**マージ済み**
3. **LOW バッチ PR #27 マージ**（パイプライン自走で実施）:
   - LOW-001: `UUID_REGEX` を `lib/text-utils.ts` に共通化 + 動的セグメント全15ルートに UUID ガード（不正→400）
   - LOW-002: `PendingInvitations.tsx` の `respond()` に `res.ok` 検査・エラー表示・リフレッシュ抑止
   - オーディが LOW 2件（friends ガード配置・失敗文言）を検出 → **PR 内で自己修正**（friends ガードを認証前へ前置、文言中立化）
   - コパ指摘2件（test-log の Next.js 版数・friends 記述の古さ）対応。**マージ済み**
4. **backlog 整理 PR #28**: 継続指摘 LOW 2件を対応済みへ。**マージ済み**
5. **OPS-001 Part1 PR #29**（オープン中）: パイプライン tester が node20 で E2E を回せるよう改修（下記「node/volta の経緯」参照）

### node/volta の経緯（重要・今セッションの主要トラブル）

- 本リポジトリは **Next.js 16.2.6**（node ≥ 20.9.0 必須）。だが **volta デフォルトが node18.20.2**、かつ **claude（Claude Code CLI）が volta で node18 に pin** されている（claude を入れた時のデフォルト node が18だったため）。
- volta は pin したツールを動かすとき、そのツールと**子プロセスに node18 を強制**（PATH 先頭に node18 実体を差し込む + `_VOLTA_TOOL_RECURSION=1`）。
- 結果、パイプライン各エージェント（`claude -p`）の子である `npm run dev` が node18 を掴み、Next.js 16 が起動拒否 → **テスタが E2E を実施不可**だった。
- **対応（PR #29 / Part1）**:
  - `package.json` に `volta.node = 20.20.2` を pin（PR #27 で同梱済み）
  - `scripts/agents.sh` の `run_tester` が dev サーバーを**自前で node20 環境で起動/停止**（PATH から node18 実体除去 + `_VOLTA_TOOL_RECURSION` 解除で volta シムに project pin=node20 を解決させる）。停止はポート3000のリスナーから**実 PGID 特定 → グループ kill**（`setsid` の `$!` は実 PGID と一致しないため）
  - Playwright chromium 自動導入ガード追加（このマシンには手動導入済み）
  - 判定ロジックで「実施不可」も不合格扱いに（false-pass 再発防止）
  - `docs/agents/tester.md` はサーバー起動指示を除去（「agents.sh 起動済み・確認のみ」）
  - **役割で node を使い分け**: dev サーバー=node20 / playwright ランナー=node18（ランナーは node18 で問題なし）
- **【決着済み 2026-05-30】** 上記「未解決の論点」は **claude をネイティブ版へ移行することで根本解決**（volta再pinではなく npm/volta 依存を断つ方を採用）。claude が node に縛られなくなったため `_VOLTA_TOOL_RECURSION` 由来の node18 強制は消滅。詳細は冒頭「2026-05-30」セクション参照。なお `scripts/agents.sh` のサニタイズ細工は now 不要だが残置（無害）。撤去判断は別途。

### 次のアクション（優先順）

1. **PR #29 のコパ対応 → マージ**（ツール/docs のみ。マージでパイプラインが E2E 自走可能に）
2. ~~claude を node20 に再 pin~~ → **完了（ネイティブ版へ移行して根本解決）**。次回 claude 起動後、`scripts/agents.sh` のサニタイズ細工が不要か実地確認 → 不要なら撤去 PR を検討
3. **OPS-001 Part2**（未対応）: E2E が本番 Supabase ターゲット → テスト用 Supabase プロジェクト + `.env.test`、またはシード&クリーンアップ戦略の設計
4. （バックログ）残 LOW: `package.json` name 変更ログの明記 / `@upstash/core-analytics` 外部送信検証
5. （バックログ）FEAT-004 法案 Hub（低優先・大物）/ MON-001・002

### 覚えておくべき判断・経緯（恒久知識）

- **パイプライン運用**: リードが `./scripts/agents.sh architect|engineer|tester|auditor` を Bash から自走させる（[[feedback-pipeline-runner]]）。task.md（最優先）→ requirements.md をアーキが読む。engineer がブランチを切る。auditor は HIGH 0 件 & 合計5件以下で通過、未修正 MEDIUM/LOW は backlog に自動追記。長時間処理は `run_in_background: true` で
- **マイグレーション適用**: `supabase_execute`（Supabase Management API・`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`）経由。`run_migrations` が `applied.txt` で適用済み管理。**applied.txt は実 DB と乖離しうるので過信しない**（実態は `pg_policies` 等で直接照会）
- **`design.md` は永続資料**: 既存セクション削除禁止・末尾追記のみ（[[feedback-design-md]]）
- guest_tokens は RLS 有効だがポリシーなし（Service Role のみ）。`expires_at` はアプリ側 ISO 計算。ゲスト参加 API はトークン発行を cases UPDATE より先に
- middleware の `/case` 保護は `/case/new` のみ。`/` は完全一致
- 配色: 被告/エラー=`rose-*`、弁護人AI=`teal-*`、プライマリ=`brand-700/800`（`brand-500` は WCAG 非対応で不使用）
- `search_users` は `SECURITY DEFINER`。`friend_requests` の UNIQUE INDEX は `(LEAST,GREATEST)` で双方向重複ブロック。拒否=レコード削除
- **SMTP は Gmail SMTP**（500通/日、アプリパスワード）。サインアップ `emailRedirectTo` は `new URL('/auth/callback', NEXT_PUBLIC_SITE_URL)`、未設定時は中断
- **API パスパラメータの UUID 検証**: `lib/text-utils.ts` の `isUuid()` を各メソッドハンドラ先頭（認証/ゲスト分岐より前・DB アクセス前）で通す（PR #27 で全15ルート対応済み）
- `gh pr edit` は古い projects classic API で失敗 → PR body 更新は `gh api -X PATCH /repos/itoemon/family_court/pulls/N -f body=...`
- Claude Code Bash ツールは毎回独立シェル。`.claude/settings.local.json` は次回起動時から有効

### 環境・ツール状態（2026-05-29 時点）

- OS: Ubuntu（tailscale + termius SSH from スマホ + tmux でセッション保持）
- node: volta 管理。デフォルト=node18.20.2、本プロジェクトは `package.json` の volta pin で **node20.20.2**。**firebase のみ** node18 に個別 pin（claude は 2026-05-30 にネイティブ版へ移行済みで volta 管理外＝`~/.local/bin/claude`）
- Playwright: chromium 導入済み（`~/.cache/ms-playwright`）。E2E ターゲットは現状**本番 Supabase**（Part2 で見直し予定）
- gh CLI: `itoemon` 認証済み。承認スキップ: `.claude/settings.local.json`（bypassPermissions）

### マージ済み PR（累計・抜粋）

- PR #19: FEAT-002-p1 プロフィール / PR #20: FEAT-002-p2 フレンド / PR #21: MEDIUM-001 検索レートリミット
- PR #22: FEAT-003 法律作成 / PR #23: BUG-001 確認メール / PR #24: トークン可視化・ログローテ / PR #25: backlog 整理
- PR #26: MEDIUM-001 RLS 二層防御（Server Component を createSessionClient 化 + laws SELECT ポリシー拡張）✅ 本番 DB 適用済み
- PR #27: LOW-001/002（UUID 共通化・全15ルートガード・fetch ステータス検査）✅
- PR #28: backlog 継続指摘 LOW 2件を対応済みへ ✅
