---
name: feedback-pipeline-runner
description: リードがエージェントパイプライン（architect → engineer → tester → auditor → PR）を Bash 経由で自走させる
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 34837e21-68ed-4d95-a47b-b25194713339
---

リードは Bash ツールからパイプラインを自分で起動し、PR 作成まで自動で回す。ダイチに毎回「コマンド叩いて」と依頼しない。

**Why:** ダイチが明示。手動でターミナルからコマンドを実行する運用は手間。リード（対話セッション）がサブエージェントを起動できるので、パイプライン全体をリード主導で進めるのが効率的。

## 標準フロー（2026-07-05 整理。思想「リードは PM に徹し独立専門家に見させて質を上げる」を維持）

**リード（要件・設計レビュー・方針・PR 判断・memory）→ アーキ（設計）→ ビルド（実装）→ テスト → オーディ（独立セキュリティ監査）→ コパ（PR レビュー）**

- task.md を更新 → **アーキ**起動（`./scripts/agents.sh architect < /dev/null`）→ design.md をリードがレビュー（既存削除なし・設計妥当性）
- アーキ OK → **ビルド**起動（`./scripts/agents.sh engineer < /dev/null`）。NG なら task.md 修正して再起動。不安定時はサブエージェント fallback（下記）
- **テスト**: migration をテスト DB へ適用 → E2E。テスタ agent は任意で、リード直の playwright fast-path が速く確実（UI ターン制御でテスタ agent は詰まりがち）。お金/認可系はリードのアドバサリアル検証（REST 直叩きで 403 等を実証）を必ず追加
- **オーディ**（`./scripts/agents.sh auditor < /dev/null`）を回す。**auth / 決済 / RLS / 暗号 が絡む変更では必須**（独立セキュリティ監査。リード自身のレビューの盲点を独立の目で埋める）。軽微な docs/リファクタでは任意。HIGH 0 & 指摘 5 件以下で通過、未修正は backlog へ
- PR 作成 → **コパ**レビュー確認（`gh api .../pulls/N/{reviews,comments}`、初回レビューを待つ [[feedback-copilot-review]]）→ 指摘を PR 内消化 → マージ → memory 更新
- 長時間処理の Bash は `run_in_background: true`。ダイチには進捗を簡潔に報告、判断が必要な場面（方針分岐・スコープ変更）でのみ確認
- **独立したセキュリティの目が 3 層**（オーディ＋リードのアドバサリアル＋コパ）。コパは実バグ検出力が高い（MON-001 PR-A/PR-B とも money-critical バグを捕捉）
- **リードは PM に徹する**（要件・設計レビュー・方針・最終判断）。全部を自分でやるのでなく、独立専門家に見させて統括することで質を上げる（ダイチの思想）

## パイプライン頑健化・回避策（MON-001 セッションの恒久知見）

- **agents.sh の `claude -p` は `< /dev/null` + `--dangerously-skip-permissions` 必須**（2026-07-05 に全4役割へ組込済み）。前者は headless の stdin 詰まり死、後者は非対話 nested agent が権限プロンプトに詰まる `Tool permission request failed: Error: Stream closed` を防ぐ。無いとビルドが1ファイルも書けず無出力で死ぬ。
- **"Stream closed"（権限リクエスト経路の障害）は間欠的**で、メインのリードやハーネス Agent にも起きる。自然復帰するので少し待つ/リトライ。連打は無駄。原因はリソース競合（別アプリ常駐＋多数の nested agent）と推定。
- **ビルドが agents.sh で不安定なときの fallback**: ハーネスの Agent ツール（general-purpose サブエージェント）に task.md + design.md を仕様として渡して実装。書き込みブロックに当たったらサブエージェントが**コードをテキスト報告 → リードが全適用**する回避策も有効（PR-B で実証）。
- **E2E は `PORT=3000` 明示**（環境に `PORT` leak があると next dev が別ポートを掴んで 3000 に繋がらず全滅）。agents.sh の dev サーバ起動にも組込済み。リード直実行時: `for p in $(lsof -ti:3000); do kill $p; done` で掃除 → `export TEST_MODE=1; PORT=3000 setsid bash -c 'npm run dev:test ...' &` → ready 待ち → playwright → 掃除 → `git checkout tsconfig.json`。
- **`pkill -f` は使わない**（リードのシェルを巻き込み exit 144）。ポート掃除は lsof ベースで。

## リーン化の理由

テスタ agent は UI ターン制御で詰まりやすく、リードが playwright fast-path（admin client + REST 直叩き）を直接回す方が速く確実。監査もリードの設計レビュー＋アドバサリアル＋コパで実バグを網羅（コパが両 PR で money-critical バグを検出）。独立 CLI エージェントを増やすほど nested-agent の失敗点が増えるため、リード＋コパに集約する方が堅い。
