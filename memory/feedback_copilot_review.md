---
name: feedback-copilot-review
description: PR 作成後はコパ (GitHub Copilot) のレビューを明示確認してからマージする
metadata:
  type: feedback
---

PR を作成したあと、CI 通過だけでなく **コパ (`copilot-pull-request-reviewer[bot]`) のレビューを明示的に確認**してからマージする。指摘があれば PR 内消化を試みる。

**Why:** 2026-06-15 BUG-005 PR #49 でリードが CI (Vercel pass) だけ確認してマージした。今回はコパ指摘ゼロで実害なしだったが、過去 PR (#41=7 件 / #44=3 件 / #45=3 件 / #47=1 件) ではほぼ毎回コパが具体的な指摘を出していた。コパは "PR の最終レビュー" として [[project-agents]] に役割定義されており、[[feedback-pipeline-runner]] にも「コパレビュー対応 → マージまで自走」と明記されているのに飛ばしたのは規範違反。次回以降は明示確認をチェックリスト化する。

**How to apply:**

- `git push -u origin <branch>` → `gh pr create` の後、**PR 作成から最低 3〜5 分待ってからコパのレビューを取得する**。コパは PR 作成時に自動レビューする bot で、通常は数分以内にコメント / レビューを残す
- 確認コマンド:
  ```
  gh api repos/itoemon/family_court/pulls/N/comments  # インラインコメント
  gh api repos/itoemon/family_court/pulls/N/reviews   # レビュー本体
  ```
- インライン件数の目安 ([[session-context]] 累積知識): 実装が綺麗だと 0-3 件、テストが緩いと 8-11 件
- ゼロ件 + 5 分以上経過 → コパ反応なしと判定してマージ可
- 指摘あり → 内容を読んで PR 内消化対象を選別:
  - **LOW で 1-3 行差分**: PR 内自己修正してマージ前に消化 (PR #27 以来の慣例)
  - **本質的指摘 (バグ・セキュリティ)**: 必ず PR 内消化
  - **スコープ外 / 設計判断**: PR コメントで「対応済み / スコープ外」と返してマージ
- 確認したらコパ反応の有無を session_context にも書き残す (件数 + 消化方針)
- 関連: [[feedback-commit-check]] (パイプライン後の git status 最終確認)、[[feedback-pipeline-runner]] (パイプライン自走運用)
