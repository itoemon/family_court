---
name: feedback-session-context
description: session_context.md は毎ターン自動更新せず、ダイチが明示したときだけ更新する
metadata:
  type: feedback
---

`memory/session_context.md` は毎ターン・毎セッション終了時に自動更新しない。ダイチが明示的に「セッションを乗り換える」「session_context を更新して」等と指示したときのみ更新する。

**Why:** 毎回更新するやり方はトークン消費が激しく、Max プランの上限に当たる。さらに開発環境を VSCode リモートトンネルから Ubuntu + tailscale + termius (SSH from スマホ) + tmux に移行したため、tmux でセッション状態が保持され、アプリを落としても同一セッションを再開できる。よってセッション間の引き継ぎドキュメントを常時最新化する必要性が下がった。

**How to apply:**
- 通常作業中は `session_context.md` への書き込みを行わない（読むのは可）
- ダイチが「セッション乗り換える」「session_context 更新して」と言ったときだけ、現在のブランチ・PR 状態・直近の作業・次のアクションをまとめて上書きする
- 以前は Stop フックで自動更新する運用と書かれていたが、現在 `.claude/settings.json` に該当 hook はなく、過去セッションが慣習的に毎ターン書き換えていただけ。今後はそれもやめる
