---
name: feedback-pipeline-runner
description: リードがエージェントパイプライン（architect → engineer → tester → auditor → PR）を Bash 経由で自走させる
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 34837e21-68ed-4d95-a47b-b25194713339
---

リードは `./scripts/agents.sh architect|engineer|tester|auditor` を Bash ツールから自分で起動し、PR 作成まで自動で回す。ダイチに毎回「コマンド叩いて」と依頼しない。

**Why:** ダイチが明示。ダイチが手動でターミナルからコマンドを実行する運用は手間。リード（対話セッション）が `claude -p` のサブセッションを起動できるので、パイプライン全体をリード主導で進めるのが効率的。

**How to apply:**
- task.md を更新したら、リードがそのままアーキを起動し、出力をレビュー
- アーキ OK ならビルド起動。NG なら task.md を修正して再起動
- ビルド完了後、テスタ → オーディの順で自動的に回す
- オーディ判定通過後、PR 作成 → コパレビュー対応 → マージまで自走
- 長時間処理の Bash 呼び出しは `run_in_background: true` で起動して完了通知を待つ
- 各段階の成果物（design.md / arch-to-eng.md / 実装コード / test-log / audit-log）は逐次レビューし、問題があれば差し戻し
- ダイチには進捗を簡潔に報告し、判断が必要な場面（方針分岐・スコープ変更など）でのみ確認を仰ぐ
