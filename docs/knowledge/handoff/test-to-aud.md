# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 矛盾チェック機能の実装
**日時**: 2026-05-24 20:39
**パイプラインステップ**: テスト完了 → オーディへ引き継ぎ

---

## テスト結果サマリー

| 結果 | 内容 |
|---|---|
| **判定** | ✅ **全件通過（11/11）** |
| CRITICAL-M01〜M04（既存: 会話フロー基本機能） | ✅ 全通過 |
| CRITICAL-H01〜H02（既存: /history アクセス制御） | ✅ 全通過 |
| **CRITICAL-C01（矛盾警告の本人のみ表示）** | ✅ 通過 |
| NORMAL-H03〜H04、NORMAL-C02〜C03 | ✅ 全通過 |

**詳細レポート**: [test-log/test_20260524_203923.md](../test-log/test_20260524_203923.md)

CRITICAL シナリオ失敗件数: 0 件（通過基準を満たす）

---

## オーディへの注意点（矛盾チェック機能）

### 1. 本人のみ表示ロジックの実装レビュー（重点確認）

E2E では「相手に警告が表示されない」ことを確認済み。実装レビューで以下を確認すること：

- [ ] `app/case/[id]/page.tsx` の `myRole === arg.role` 判定でフィルタリングされているか
- [ ] `caseData.contradictionWarnings` が API レスポンスに含まれるのは **認証ユーザー本人のデータのみ** か（RLS + userId フィルタ）
- [ ] observer（`myRole === null`）には一切警告が表示されないか

### 2. RLS ポリシー確認

- [ ] `contradiction_warnings` テーブルに RLS が有効化されているか
- [ ] `SELECT` ポリシーが `user_id = auth.uid()` のみ許可しているか
- [ ] クライアントから直接 INSERT できないか（admin クライアント経由のみ）

### 3. 矛盾チェックトリガーの確認

- [ ] `app/api/cases/[id]/argument/route.ts` で発言 INSERT 後に矛盾チェックが実行されるか
- [ ] `authenticatedUserId` が null の場合（ゲスト）はスキップされるか
- [ ] `api_key_encrypted` が null の場合はスキップされるか（エラーなし）
- [ ] `pastCases.length === 0` の場合はスキップされるか（発言レスポンスは正常）
- [ ] `checkContradiction` が例外を投げても try-catch で握りつぶされ、発言レスポンスは正常に返るか

### 4. API キー取得元の確認

- [ ] 矛盾チェックの API キーは **原告（`plaintiff_id`）の `api_key_encrypted`** から取得しているか
- [ ] 被告が発言した場合も原告のキーを使う設計であることを確認

### 5. 過去ケース参照ロジックの確認

- [ ] 過去ケース（phase = "verdict"）を直近 3 件取得しているか
- [ ] 各ケースから同一ロールの発言を最大 15 件取得しているか
- [ ] 現在のケース（`neq("id", id)`）が除外されているか

### 6. 警告バブルのデザイン確認

- [ ] `ContradictionWarningBubble.tsx` が `bg-amber-50 border-amber-200` で描画されているか
- [ ] ⚠️ アイコン + `amber-700` テキストであるか
- [ ] judge バブル（`border-amber-100`）と視覚的に区別できるか

### 7. 型定義の確認

- [ ] `lib/types.ts` に `ContradictionWarning` 型が追加されているか
- [ ] `Case` インターフェースに `contradictionWarnings: ContradictionWarning[]` が追加されているか
- [ ] `app/api/cases/[id]/verdict/route.ts` に `contradictionWarnings: []` が追加されているか（型エラー解消）

---

## テストできなかったこと・スコープ外

### API キー未設定環境での制約

テスト環境ではテストユーザーに API キーが設定されていないため、以下は E2E で直接確認できていない：

- **矛盾警告メッセージの実際の表示**: 矛盾あり判定時の amber バブルの UI 表示
- **矛盾あり判定の精度**: プロンプトの品質・50 文字制限の遵守
- **警告メッセージの amber デザイン確認**: 手動テスト（API キーあり環境）推奨

### 設計書スコープ外（task.md 明記）

- 相手の発言との矛盾チェック
- 矛盾の深刻度分類
- 警告の非表示・スヌーズ機能
- ページネーション（過去ケースは直近 3 件固定）
- ゲストユーザーの矛盾チェック

---

## ビルド実装ノート（eng-to-aud.md より）

1. **API キー取得先**: 原告の `api_key_encrypted` を使用（被告発言時も原告キーを使う設計）
2. **`callerRole` の型**: `Role | null` のまま（実質非 null が保証されているが型が緩い。実害なし・設計書スコープ外）
3. **verdict route の修正**: `contradictionWarnings: []` 追加（型エラー解消のみ、設計書意図に沿った最小修正）

---

**参照**: [test-log/test_20260524_203923.md](../test-log/test_20260524_203923.md), [design.md](../design.md), [eng-to-aud.md](eng-to-aud.md)
