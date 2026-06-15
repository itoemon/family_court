---
name: feedback-commit-check
description: パイプライン経由の PR では commit 前に必ず git status で untracked / unstaged 確認を行う
metadata:
  type: feedback
---

パイプライン（テスタ・オーディ）を回す PR では、commit と push の前に必ず `git status` を確認して **未追跡ファイル（??）と変更未ステージ（M）を全件チェック**する。とくに以下のパターンは取りこぼしやすい:

- `tests/e2e/*.spec.ts` — テスタが新規 spec を作る場合、untracked のまま放置されると CI で実行されずリグレッション検知が機能しなくなる
- `docs/knowledge/test-log/*.md` / `docs/knowledge/audit-log/*.md` — テスタ・オーディの実行ログ、証跡として PR に含めるべき
- `docs/knowledge/archive/**` と削除（D）— rotate_logs.sh で古いログが archive に移動する。R（rename）扱いで両方 add が必要
- `docs/knowledge/handoff/test-to-aud.md` — テスタが書く引き継ぎメモ、modified 状態になっている

**Why:** 2026-06-15 に同じパターンの commit 忘れを 2 回連続で発生させた。

1. PR #44 (BUG-007): リードのコード修正（HIGH-001 open redirect 対応）と新規 spec を commit せずに push、オーディが「PR #44 HEAD には修正が含まれていない（HIGH-001）」「新規 spec が untracked のまま PR に含まれていない（MEDIUM-001）」と git tracking 状態の照合で catch
2. PR #45 (BUG-004): 同じ仕組みで `tests/e2e/bug004-defense-tab.spec.ts` と audit-log を add し忘れ、PR #44 のときと同じ漏れを再発させた → PR #46 で補修するハメに

**How to apply:**
- パイプライン後（テスタ・オーディ実行後）に commit する前、必ず `git status --short` を確認する
- `??` で出る untracked ファイルが「今回の作業の成果物」に含まれるべきか判断する
- 特に `tests/e2e/` 直下と `docs/knowledge/(test|audit)-log/` 直下と `docs/knowledge/archive/` は要注意
- `git add <ファイル名>` で明示的に指定するときも、`git add docs/knowledge/` のようにディレクトリ単位で add する方が漏れにくい（ただし `tests/e2e/` も別途忘れずに）
- 心配なら commit 前にもう一度 `git diff --cached --stat` で「これから commit する内容」を俯瞰する
- オーディは git tracking 状態を見るので、先回り catch のために `git status` を最終チェックリストに入れる
