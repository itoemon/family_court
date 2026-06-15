# テスタ → オーディ 引き継ぎメモ（BUG-005）

**実行日**: 2026-06-15  
**最終実行**: 19:22:48（リードによる手動実行、`test_20260615_192248.md` 参照）  
**対象**: BUG-005 — 閉廷 AI 生成アナウンス条件の修正  
**テスト判定**: ✅ **通過**（CRITICAL 4/4 通過 + BUG-005 3/3 通過）

---

## 経緯

オーディ初回監査 (`audit_20260615_165040.md`) で MEDIUM-001 が指摘された:

- BUG-005-2 / BUG-005-3 が `expect(true).toBe(true)` のダミー spec で、task.md 必須シナリオ #2/#3 が end-to-end で一切検証されていない

テスタ再実行 (`test_20260615_180754.md`) で動的検証への置き換えを試みたが、UI のターン制御 (3R + 投票) を Playwright で再現するロジックが 60s+ タイムアウトし、BUG-005-2/3 は依然 failed。

その後、リードが spec を fast-path（admin client で arguments を 3R 分 INSERT + cases.phase を強制遷移 → REST API で投票送信）へ書き直して手動実行し、3/3 通過 + 17.3 秒の実行時間を確認した。

## 最終テスト実行結果

| テスト | 結果 | 実行時間 |
|--------|------|---------|
| BUG-005-1: argument フェーズ中は closing が生成されていない | ✅ | 8.5s |
| BUG-005-2: 延長投票で両者 finish → closing greeting + AI 閉廷宣告が順序通りに挿入される | ✅ | 4.2s |
| BUG-005-3: 早期終了 (end-proposal) 両者合意 → closing greeting + AI 閉廷宣告が順序通りに挿入される | ✅ | 4.1s |

CRITICAL M01〜M04 は本変更 (spec ファイルの局所修正) で影響を受けない。直近のリグレッション確認は `test_20260615_180754.md` の実行結果に依拠する。

## オーディに対する確認観点

### 1. 共通ヘルパー関数の責務境界

`tests/e2e/bug005-closing-trigger.spec.ts:128-188` に新規導入したヘルパー (`fastSkipToExtensionVoting`, `fastSkipToArgumentR1`, `pollClosingJudgeMessage`) が以下を満たすこと:

- admin client (`SUPABASE_SECRET_KEY`) でのみ DB 書き換えを行い、UI を経由しない
- `cases` の状態を強制遷移させても本実装 (`lib/case-closing.ts` の AI 閉廷宣告生成) の挙動を歪めていない（**呼ばれる経路自体はそのまま REST API**）

### 2. API キー有無による条件分岐 assertion

E2E ユーザー A (`e2e_user_a@example.com`) の `profiles.api_key_encrypted` が現状 NULL であるため、`lib/case-closing.ts:24-29` の早期 return パスが実行される。spec はこれを動的に判定する:

- **API キー SET**: `judge_messages.trigger_type='closing'` が 1 行 INSERT、closing greeting (`arguments`) → AI 閉廷宣告 (`judge_messages`) の `created_at` 順序を検証
- **API キー NULL**: `judge_messages.trigger_type='closing'` が 0 行で留まることを検証

両ケースで closing greeting (`arguments`, 2 行, `role=plaintiff/defendant`) は必ず挿入されることを共通の必須 assertion とする。

### 3. リード手動実行という事実

通常のパイプラインでは spec はテスタが書く。今回はテスタが UI ターン制御の複雑性で 2 度連続でタイムアウトを発生させたため、リードが fast-path 書き換えを行った。これは [[project-agents]] の役割分担を一時的に逸脱しているが、test-log と handoff には経緯を明記している。

### 4. backlog の MEDIUM-001 削除

`docs/backlog.md` に自動追記された MEDIUM-001 は本対応で消化済み。オーディ承認後にリードが削除する予定。

## やり残し（次パイプラインの宿題）

- `dev:test` 起動時に Next.js が `tsconfig.json` を自動書き換えする (`include` に `.next/dev/dev/types/**/*.ts` を追加) 挙動が再現性をもって観測される。リードが `git restore tsconfig.json` で revert しているが、根本対応は別 backlog 化が筋。
- E2E ユーザー A の `profiles.api_key_encrypted` 登録に踏み込めば、本タスクで未実行の「推奨 #4: AI 生成失敗時の greeting 残置」「推奨 #5: extension_voting 中 polling での増分検査」も spec 化できる。ただし Anthropic API への実 call が走るためコスト評価が必要。
