# アーキ → ビルド 引き継ぎメモ

**タスク**: 過去ケース一覧・詳細閲覧機能の実装
**設計書**: `docs/knowledge/design.md`

---

## 実装の順序と依存関係

| 順番 | ファイル | 内容 | 依存 |
|------|----------|------|------|
| 1 | `middleware.ts` | `/history` パスが保護対象に含まれているか確認。なければ追加 | なし |
| 2 | `lib/types.ts` | `HistoryCase` 型を追加 | なし |
| 3 | `app/history/page.tsx` | Server Component として新設 | 順番 1・2 |

---

## 設計上の判断

### API Route を作らない理由

`/history` は認証済みユーザー専用の完全サーバーサイドレンダリングページ。Server Component から直接 Supabase クエリを発行することで、API Route を経由する往復なしにデータを取得できる。

### スキーマ変更ゼロの理由

`plaintiff_id` / `defendant_id` で十分にクエリが完結する。task.md の明示的な方針。追加カラム・テーブルを作る必要はない。

### ゲストユーザー除外が追加フィルタ不要な理由

`defendant_id IS NULL`（ゲスト参加）のケースは `OR defendant_id = userId` にマッチしないため自動的に除外される。意図せず包含するコードを書かない限り、フィルタは不要。

### UUID をクライアントに渡さない理由

backlog MEDIUM-001（ケース API が内部ユーザー UUID を認証なしに公開）の影響範囲を拡大しないため、`HistoryCase` 型には `id`（ケース ID）と `opponentName` のみを含める。`plaintiff_id` / `defendant_id` の UUID はサーバー側での opponent 名決定にのみ使用する。

---

## 注意事項・落とし穴

### middleware.ts の確認

現在の middleware.ts が `/history` を保護対象に含んでいるかを確認すること。`/profile` など認証必須パスと同じ仕組みで追加する。

### Supabase JS SDK の二重 FK JOIN

`plaintiff_id` と `defendant_id` は同じ `profiles` テーブルへの FK が 2 つある。FK 制約名によるエイリアスが必要：

```ts
const { data } = await supabase
  .from("cases")
  .select(`
    id, topic, phase, created_at, plaintiff_id, defendant_id, defendant_guest_name,
    plaintiff_profile:profiles!cases_plaintiff_id_fkey(display_name),
    defendant_profile:profiles!cases_defendant_id_fkey(display_name)
  `)
  .or(`plaintiff_id.eq.${userId},defendant_id.eq.${userId}`)
  .eq("phase", "verdict")
  .order("created_at", { ascending: false });
```

FK 制約名が `supabase/schema.sql` に定義されていない場合は二段クエリで対応する：

1. `cases` を取得（JOIN なし）
2. 取得した `plaintiff_id` / `defendant_id` のセットで `profiles` を取得してマージ

### `phase = 'verdict'` フィルタの適用漏れ

`.eq("phase", "verdict")` を忘れると進行中ケースが履歴に混在する。

### `/case/[id]` への既存変更は不要

task.md が「新規ページ不要」と明言している。verdict フェーズのケースは自然に読み取り専用となる前提。もし発言フォームが表示されてしまう場合は、既存ページの phase 判定ロジックで解決する。

---

## スコープ外（バックログに残す）

| 内容 | 理由 |
|------|------|
| ゲストユーザーの過去ケース参照 | 永続 ID なし。task.md 明示 |
| ページネーション | 件数が少ない前提。task.md 明示 |
| 二人のユーザー間のケース横断検索 | 別タスク（矛盾チェック）|
| ケースの削除・非表示機能 | 別タスク |
| MEDIUM-001（UUID公開）他バックログ | 既存バックログ |
