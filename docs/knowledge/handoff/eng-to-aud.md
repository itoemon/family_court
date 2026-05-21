# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: PR #4 コパ指摘 — camelCase/snake_case 不整合修正
**コミット**: 3cfa9ad
**日時**: 2026-05-21

---

## 実装上の判断・変更点

### 設計書から逸脱した点（アーキ設計書は PR #3 対応を対象としているため今回は参照外）

**1. `buildCaseResponse` を `lib/case-response.ts` に切り出した**

task.md は「`buildCaseResponse` を共通関数として両ハンドラで再利用すること」と記載しており、
`app/api/cases/[id]/route.ts` の既存関数をそのまま流用するのではなく、
`lib/case-response.ts` を新設してそこに移動した。

Route ファイル間でのクロスインポートはモジュール境界が不明瞭になるためライブラリ層に置くのが適切であり、
かつ `lib/` は書き込み許可ディレクトリのため問題なし。

**2. GET ハンドラで raw case を先フェッチ（DB クエリ 1 往復増加）**

`buildCaseResponse` が内部フィールド（`plaintiff_id`, `defendant_id`, `defendant_guest_name`）を
レスポンスに含まなくなったため、GET ハンドラの `callerRole` 判定がこれらに直接アクセスできなくなった。

対策として、GET ハンドラの冒頭で以下の最小限フィールドだけを取得するクエリを追加した：

```typescript
const { data: rawCase } = await admin
  .from("cases")
  .select("plaintiff_id, defendant_id, defendant_guest_name")
  .eq("id", id)
  .single();
```

この追加クエリにより `cases` テーブルへの往復が 1 回増えるが、
アプリのスケールを考慮すると許容範囲。

**3. `argument/route.ts` の重複コードを削除**

`buildCaseResponse` に移行したことで、`updatedCase`, `args`, `plaintiff`, `defendant` の
個別フェッチコードが不要になり削除した。コード行数が削減され保守性が向上している。

---

## オーディへの注意点

### 重点テストケース

1. **GET /api/cases/[id] のレスポンス形状**
   - `currentTurn`, `maxRounds`, `createdAt`, `updatedAt` が camelCase で返ること（snake_case でないこと）
   - `plaintiff_id`, `defendant_id`, `current_turn`, `max_rounds`, `created_at`, `updated_at`（snake_case 版）が **含まれない** こと
   - `defendantId` と `callerRole` が引き続き含まれること

2. **POST /api/cases/[id]/argument のレスポンス形状**
   - 同上の camelCase 形状チェック
   - 発言後にターン交代・フェーズ進行が正しく反映されていること（`currentTurn`, `phase`, `round`）
   - `arguments` 配列に今回の発言が追加されていること

3. **PATCH /api/cases/[id]（既存動作の回帰確認）**
   - アカウント参加・ゲスト参加後のレスポンスも camelCase になっていること
   - ゲスト参加時の httpOnly Cookie が引き続き設定されること

4. **クライアント側の動作**
   - `caseData.currentTurn` が `undefined` にならないこと（ターン判定・発言フォーム表示が壊れていないこと）
   - ページリロード後も `callerRole` が正しく復元されること

### セキュリティ確認ポイント

- `plaintiff_id` / `defendant_id` / `defendant_guest_name` がレスポンス JSON に **含まれていない** ことを確認すること（内部カラムの隠蔽）
- `callerRole` の判定はサーバー側のみで実施されており、クライアントに UUID が渡っていないこと

---

## 未実装・スコープ外にしたこと

| バックログ | 内容 |
|-----------|------|
| `Argument` 型の `timestamp` vs DB `created_at` の不整合 | `lib/types.ts` の `Argument.timestamp` と DB の `created_at` が一致していない。今回のスコープ外だが `arguments` 配列の `timestamp` フィールドがクライアントで `undefined` になる可能性あり。要確認 |
| MEDIUM-001 | GET レスポンスから `plaintiff_id` / `defendant_id` UUID を除外（今回で実質対応済みだが、設計書上の MEDIUM-001 としては別タスク扱い） |
| MEDIUM-002 | HMAC トークンの決定論的問題（取り消し・個別セッション無効化） |
| LOW-001 (route.ts) | ゲスト名の最大長バリデーションなし |
| LOW-001 (claude.ts) | `validateApiKey` のエラー種別区別 |
| MEDIUM (auth.ts) | ログアウト失敗時のユーザー通知 |
| LOW (layout.tsx) | `<main>` タグの二重ネスト |
