---
name: feedback-pipeline-runner
description: リードが harness サブエージェントを編成して architect → engineer → auditor → PR まで自走させる（2026-07-16 ゼロベース再設計）
metadata:
  node_type: memory
  type: feedback
  originSessionId: 34837e21-68ed-4d95-a47b-b25194713339
---

リードは対話セッションから**パイプライン全体を自分で編成して回す**。ダイチに毎回「コマンド叩いて」と依頼しない。

**Why:** ダイチが明示。手動でターミナルからコマンドを実行する運用は手間。リード（対話セッション）が独立サブエージェントを起動できるので、パイプライン全体をリード主導で進めるのが効率的。

---

## ★2026-07-16 ゼロベース再設計（重要・これが現行方式）

**実行基盤を `scripts/agents.sh`（nested `claude -p`）から「リード編成 × harness サブエージェント（Agent ツール）」へ全面移行した。**

**Why:** `agents.sh` の nested `claude -p` は (1) 重タスク（肥大 design.md への追記・多ファイル実装）で**無出力死**、(2) **エラーを飲み込み観測性ゼロ**（毎回「無出力で死んだ」しか分からない）、(3) background 実行は**セッション境界で孤児化**する、という三重苦で信頼できない。対して harness の `Agent` ツール（general-purpose サブエージェント）は今セッションで**設計・実装・監査すべて成功**。①信頼できる ②結果が構造化テキストで返る＝**観測できる** ③独立コンテキスト＝「独立の目」も保つ、と全項目で上回る。

**`scripts/agents.sh` は deprecated（正式廃止）。** 参照はしてよいが、新規パイプラインでは使わない。将来「リード不在の完全自律 cron 実行」が要るときは `agents.sh` 延命でなく **Workflow（決定論的マルチエージェント編成・opt-in）** で作り直す。

### 現行フロー（リードが Agent ツールで各役割を独立サブエージェントとして起動）

**リード（要件・設計レビュー・テスト・アドバサリアル・PR 判断・memory）が全体を編成する:**

1. **要件**: リードが `docs/knowledge/task.md` を執筆（スコープ・確定値・関連ファイル・テスト観点・監査観点）。数値等の product 判断はダイチに確認（価格・上限は「ダイチ一任・定数集約で後から調整可」）。
2. **アーキ〔harness subagent〕**: `Agent`（general-purpose）に「task.md + 既存 design.md を読んで `design.md` 末尾に純追記」させる。プロンプトに「既存セクション削除・書き換え禁止・**Edit で末尾追記**（Write 全書き直し禁止）」を明記。→ **リードが design をレビュー**（既存削除なし・設計妥当性・money/認可の原子性）。
3. **ビルド〔harness subagent〕**: `Agent`（general-purpose）に「design.md の該当セクション + task.md を仕様として実装」させる。プロンプトに「既存認可・挙動を壊さない」「**実装後 `npx tsc --noEmit` と `npx eslint` を緑にする**」「migration は当てない（リードが適用）」「コミットしない（リードがレビュー後）」を明記。→ **リードが実装をレビュー**（money-critical の核心は自分で読む）。
4. **テスト**: **リード直の playwright fast-path**（admin client + REST 直叩き）。テスタは agent 化しない（UI ターン制御で詰まるため）。お金/認可系は**リードのアドバサリアル検証を必ず追加**（REST 直で 403/429・並行で cap を超えない等を実証）。
5. **オーディ〔harness subagent〕**: `Agent`（general-purpose）に「実装差分を独立監査。**コードは読み取り専用**・結果はレポートをテキストで返す」させる。**auth / 決済 / RLS / 暗号 / お金 が絡む変更では必須**。HIGH 0 & 指摘 5 件以下で通過、未修正は backlog へ。
6. **PR → コパ**: リードが PR 作成 → **コパ（GitHub Copilot）の初回レビューを待って**確認（[[feedback-copilot-review]]）→ 指摘を PR 内消化 → CI 緑確認 → マージ → memory/backlog 更新。

- 長時間処理は `run_in_background: true`。ダイチには進捗を簡潔に報告、判断が必要な場面（方針分岐・スコープ変更・product 数値）でのみ確認。
- **独立したセキュリティの目が 3 層**（オーディ＋リードのアドバサリアル＋コパ）。コパは実バグ検出力が高い。
- **リードは PM に徹する**（要件・設計/コードレビュー・方針・最終判断）。全部を自分でやるのでなく、独立サブエージェントに見させて統括することで質を上げる（ダイチの思想）。ただし harness の信頼性が高い今、**中断・トークン失効・環境障害でサブエージェントが詰まったらリードが直接引き取って完遂してよい**（今セッションで E2E spec 執筆・パッチ適用をリード直で実施）。

### harness サブエージェント運用の勘所

- **プロンプトは自己完結に**（サブエージェントは会話コンテキストを持たない）。参照ファイルの絶対パス・厳守事項・最終報告の形式を明記する。
- **中断（孤児化）に備える**: background agent はセッション境界で停止し得る。完了しなくても**成果物は disk に landed している**ことが多い（今回ビルドは spec 以外を landed）。`git status` と tsc/eslint で landed 分を確認 → **残りはリードが引き取る**のが速い（再起動しやすい background を粘るより確実）。
- **独立性の担保**: 実装したサブエージェントと監査するサブエージェントは別インスタンス（別コンテキスト）にする。リード自身のレビューは「自分の近くの仕事」で盲点が出るため、独立の目を必ず残す。

---

## テスト DB への migration 適用（テスト段の前提）

- テスト DB へ migration を当てるのは **Supabase Management API**（`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`、`.env.test` に格納）。`set -a && source .env.test && set +a` してから、**本番 ref ガード**（値は直書きせず `scripts/setup-test-db.sh` の `PROD_PROJECT_REF` に集約済み。それと一致したら中止）を噛ませて `POST /v1/projects/{ref}/database/query` に migration SQL を投げる。migration は冪等前提（`IF NOT EXISTS` / `CREATE OR REPLACE`）。
- **`SUPABASE_ACCESS_TOKEN` は失効する**（Management API が `{"message":"Unauthorized"}` を返す＝トークン切れ）。その場合は**ダイチに更新を依頼**（Supabase ダッシュボード → Account → Access Tokens で再発行 → `.env.test` 更新）。リードは非対話で再発行できない。
- 一括セットアップは `scripts/setup-test-db.sh`（schema.sql → migrations 全適用・本番 ref ブロック・`--dry-run`・`--clean-cases`）。単一 migration だけなら Management API 直で足りる。

## E2E fast-path（リード直・恒久知識）

- 作法: `for p in $(lsof -ti:3000); do kill $p; done` で掃除 → `export TEST_MODE=1; setsid bash -c 'PORT=3000 NODE_ENV=test npx next dev ...' &` → curl で ready 待ち → playwright → 掃除 → `git checkout tsconfig.json`（dev サーバが include を書き換えるため）。
- **`PORT=3000` を明示必須**（環境に `PORT` leak があると next dev が別ポートを掴んで 3000 に繋がらず全滅）。**`pkill -f` は使わない**（リードのシェルを巻き込み exit 144）。ポート掃除は lsof ベースで。
- spec は `TEST_MODE=1` を beforeEach で必須ガード（未設定なら skip）。実 Anthropic を叩くルート（verdict/defense 等）は `lib/*.ts` に `TEST_MODE==="1" && NODE_ENV!=="production"` のモック分岐を持たせる。
- **第1層(レート20/分)と第2層(ケース上限)のような多層防御は、下位の閾値に先に当たる**。上位（ケース上限30）を検証するには admin で境界値（cap-1）に seed してから叩く（SEC-002 で確立）。

## 環境・ハーネス側の恒久知識

- **"Tool permission request failed: Error: Stream closed" の根治（2026-07-12）**: 原因は claude-chat（Agent SDK 駆動の自作 Web アプリ `~/Documents/claude-chat`）の**許可経路の stdio 往復**。読み取りは往復ゼロで通り、Edit/Write/Bash は往復が要るため壊れると失敗。**bypass 時に `permissionMode:"bypassPermissions"` を実際に SDK へ渡し往復ゼロに**＋SDK 0.3.207＋try/catch で解消。blue(8801)/green(8802) の blue-green（`~/Documents/claude-chat/{promote,rollback}.sh`）。再発時は rollback。詳細は session_context 参照。
- **bypass では AskUserQuestion カードが出ない**（Claude 自己判断で進む）→ リードが方針を聞くときは**普通のテキストで聞く**（往復不要で確実）。
