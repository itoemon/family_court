# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 弁護人AI機能のゲストユーザー開放  
**日時**: 2026-05-25

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260525000002_defense_messages_guest_support.sql` | 新設 | `defense_messages.user_id` の NOT NULL 制約削除 |
| `app/api/cases/[id]/defense/route.ts` | 変更 | `resolveAuth()` をゲストトークン対応に改修、`userId` 変数で DB クエリを分岐 |
| `app/api/cases/[id]/defense/draft/route.ts` | 変更 | インライン認証にゲスト分岐を追加、`userId` 変数で DB クエリを分岐 |

---

## 実装上の判断・変更点

### defense/route.ts の resolveAuth 改修

設計書の `resolveAuth` シグネチャに従い `req: NextRequest` を第1引数に追加した。
返り値に `userId: string | null` を追加し、`user.id` への直接参照をすべて `userId` 経由に統一した。

DB クエリの分岐パターン:
```ts
userId ? query.eq("user_id", userId) : query.is("user_id", null)
```

INSERT 時は `user_id: userId`（null を渡すと NULL として保存される。migration で NOT NULL 制約を削除済み）。

### defense/draft/route.ts の認証ロジック

元の実装は `resolveAuth` 関数を持たずインラインで認証していた。設計書の指示（「同様に認可ロジックをゲスト対応に変更」）に従い、インライン認証のままゲスト分岐を追加した。`userId` / `userRole` を事前に確定してから後続処理に渡す構造にした。

---

## オーディへの注意点

### 重点確認ポイント

1. **ゲストトークンなしのアクセスが 401 になること**
   - `guest_defendant_${id}` Cookie が存在しない → 401
   - Cookie が存在するが署名が不正（`verifyGuestToken` が `false`）→ 401

2. **認証済みユーザーのデータとゲストのデータが混在しないこと**
   - 認証済み: `WHERE case_id = id AND user_id = user.id`
   - ゲスト: `WHERE case_id = id AND user_id IS NULL`
   - 別ユーザーの defense_messages が取得・上書きされないこと

3. **ゲストが `defendant_guest_name` のないケースに侵入できないこと**
   - `c.defendant_guest_name` が falsy の場合はゲストパスに分岐せず 401 を返す

4. **ゲストのロールが常に `"defendant"` に固定されていること**
   - ゲストは原告として弁護人AIを使えない

5. **defense_messages への INSERT が `user_id: null` で成功すること**
   - migration（`20260525000002_defense_messages_guest_support.sql`）が DB に適用済みであること

6. **認証済みユーザーの従来動作が変わっていないこと**
   - セッションユーザーが存在する場合は従来通りの認可チェック（plaintiff / defendant 判定）が機能すること

### セキュリティ観点

- ゲストトークン検証は `verifyGuestToken`（HMAC-SHA256、timing-safe compare）を使用
- `user_id IS NULL` はゲストのデータ識別子であり、セキュリティゲートは Cookie 検証
- `guest_defendant_${id}` Cookie のスコープは既存の発行ロジックに依存（本実装では変更なし）

---

## 未実装・スコープ外

| 項目 | 理由 |
|---|---|
| フロントエンドの変更 | API 対応のみで動作する設計。task.md 明示でスコープ外 |
| RLS ポリシーの変更 | admin クライアント経由のため不要。task.md 明示でスコープ外 |
| ゲストユーザーの矛盾チェック | 永続 ID なし。task.md 明示でスコープ外 |
| 複数ゲストの同一ケース参加 | 仕様上あり得ない。設計書明示でスコープ外 |
