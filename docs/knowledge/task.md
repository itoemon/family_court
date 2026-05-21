# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

コパ（PR #4）指摘の camelCase/snake_case 不整合を修正する。

## 修正対象

### 1. cases/[id]/route.ts — buildCaseResponse の snake_case → camelCase マッピング（HIGH）

`app/api/cases/[id]/route.ts` の `buildCaseResponse` 関数が DB 行（`current_turn`, `max_rounds`, `created_at`, `updated_at`）を `...c` でそのままスプレッドして返している。
クライアント側の `Case` 型は camelCase（`currentTurn`, `maxRounds`, `createdAt`, `updatedAt`）を期待しているため、`caseData.currentTurn` が `undefined` となりターン判定・発言フォーム表示が壊れている。

レスポンスオブジェクトを明示的に組み立て、snake_case → camelCase にマッピングすること。
また `plaintiff_id` / `defendant_id` などクライアントが不要な内部カラムはレスポンスから除外すること（`callerRole`, `defendantId` は除く）。

### 2. cases/[id]/argument/route.ts — POST レスポンスの同様修正（HIGH）

`app/api/cases/[id]/argument/route.ts` の POST ハンドラも `...updatedCase` でスプレッドして返しており、同じ snake_case 問題がある。
こちらも `buildCaseResponse` と同様に明示的な camelCase マッピングに統一すること。

理想的には `buildCaseResponse` を共通関数として両ハンドラで再利用すること（既に `cases/[id]/route.ts` に `buildCaseResponse` があればそれを使う）。

## スコープ外

- 上記以外の変更
- UI デザインの変更
- 新機能追加
