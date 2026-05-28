---
name: feedback-design-md
description: design.md は永続資料として加筆・修正で育てる。全面書き換えはしない
metadata:
  type: feedback
---

`docs/knowledge/design.md` はプロダクト全体の累積設計書として永続的に育てる。新しい機能追加や監査由来の修正設計を扱うときも、**既存の設計を残したまま該当セクションを追記・修正する**。アーキ起動時の task.md には必ず「**追記方式で**書く」「**既存の設計を消さない**」と明記する。

**Why:** design.md は FEAT-003 等の機能設計が累積された永続資料。過去の設計が消えると、後続のアーキ／ビルド／オーディが設計意図を辿れなくなり、設計の一貫性が失われる。実際に MEDIUM-001 セッションでアーキが全面書き換えして FEAT-003 設計が消失した事例があった。

**How to apply:**
- アーキ起動前の task.md に「`design.md` は既存内容を保持したまま **末尾に該当セクションを追記**」を明示
- 同じく「FEAT-003 等の既存設計を削除・短縮しない」を明示
- 設計書が肥大化したら機能別分割を別 backlog 項目で実施（現状の任意整備項目を参照）
- アーキ実行後に `git diff --stat docs/knowledge/design.md` で削除行数が大きい場合は加筆方式に違反している兆候。git restore して再実行する
- 関連: [[project-agents]] のアーキ役割定義、[[feedback-pipeline-runner]] のループ運用
