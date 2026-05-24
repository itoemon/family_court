# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 矛盾チェック機能の実装  
**日時**: 2026-05-24

---

## 実装上の判断・変更点

### 変更・追加ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260524210000_create_contradiction_warnings.sql` | 新設 | contradiction_warnings テーブル + RLS ポリシー |
| `lib/types.ts` | 変更 | `ContradictionWarning` 型追加、`Case` に `contradictionWarnings` フィールド追加 |
| `lib/contradiction.ts` | 新設 | claude-haiku-4-5-20251001 による矛盾判定ロジック |
| `app/components/ContradictionWarningBubble.tsx` | 新設 | ⚠️ amber 系警告バブルコンポーネント |
| `lib/case-response.ts` | 変更 | `userId` 引数追加、contradiction_warnings クエリ追加 |
| `app/api/cases/[id]/argument/route.ts` | 変更 | 発言 INSERT 後の矛盾チェック、buildCaseResponse に userId 渡す |
| `app/api/cases/[id]/route.ts` | 変更 | GET 時に userId を buildCaseResponse に渡す |
| `app/api/cases/[id]/verdict/route.ts` | 変更 | Case 型の `contradictionWarnings: []` を追加（型エラー解消のみ） |
| `app/case/[id]/page.tsx` | 変更 | タイムラインの発言直下に本人のみ警告バブルを表示 |

---

### `app/api/cases/[id]/verdict/route.ts` の修正（設計書に記載なし）

`Case` インターフェースに `contradictionWarnings` を必須フィールドとして追加したため、verdict route が `Case` 型のオブジェクトを直接構築する箇所で型エラーが発生した。`contradictionWarnings: []` を追加して解消した。設計書の変更意図（型エラー防止）に沿った最小限の修正である。

---

### 矛盾チェックの API キー取得先（設計書どおり）

矛盾チェックの API キーは原告（`plaintiff_id`）の `api_key_encrypted` から取得する。被告が発言した場合も原告のキーを使う設計。`api_key_encrypted` が存在しない場合はスキップ（ログなし）。これは設計書・handoff の指示どおり。

---

### `callerRole` が `null` の場合の矛盾チェック

矛盾チェックは `authenticatedUserId && insertedArg?.id` の条件で実行される。`callerRole` が `null` の時点で 403 を返すため、矛盾チェックブロックに到達する時点で `callerRole` は非 null が保証される。ただし `callerRole` 変数の型は `Role | null` のままであるため、クエリの `.eq("role", callerRole)` に渡す際は非 null が実質的に保証されているが型が緩い。実害はなく型安全性の改善は設計書スコープ外のため現状維持。

---

## オーディへの注意点

### 重点確認ポイント

1. **矛盾チェックのトリガー**: 発言 POST 後に矛盾チェックが実行されること。過去ケースが 0 件の場合は何もしないこと（スキップ）。

2. **本人のみ表示**: `myRole === arg.role` の条件でフィルタリングしているため、相手の発言には警告バブルが表示されないこと。observer（`myRole === null`）には一切表示されないこと。

3. **RLS**: `contradiction_warnings` テーブルへの SELECT は `user_id = auth.uid()` でのみ許可されること。INSERT は admin クライアント経由のみ（クライアントから直接書き込み不可）。

4. **API キー不在の場合**: 原告が API キーを登録していない場合、矛盾チェックがスキップされ、発言・ターン交代は正常に完了すること。

5. **矛盾チェック失敗の場合**: `checkContradiction` が例外を投げても try-catch で握りつぶされ、発言のレスポンスは正常に返ること。

6. **警告バブルのデザイン**: amber-50 背景、amber-200 ボーダー、amber-700 テキスト、⚠️ アイコンで表示されること。judge バブル（amber-50/100）と視覚的に区別できること。

7. **ゲストユーザー**: `authenticatedUserId === null` の場合に矛盾チェックをスキップすること（ゲスト被告は永続 ID がないため）。

8. **既存機能への影響**: 発言投稿・ターン交代・judge メッセージ生成・verdict 生成が従来どおり動作すること。

---

## 未実装・スコープ外

| 項目 | 理由 |
|---|---|
| 相手の発言との矛盾チェック | task.md 明示でスコープ外 |
| 矛盾の深刻度分類 | task.md 明示でスコープ外 |
| 警告の非表示・スヌーズ機能 | task.md 明示でスコープ外 |
| ページネーション（過去ケース参照） | task.md 明示でスコープ外、直近 3 件固定 |
| ゲストユーザーの矛盾チェック | 永続 ID なし。設計書明示 |
| `callerRole` 型の厳密化 | 設計書スコープ外 |
