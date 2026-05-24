# 詳細設計書

## 概要（変更の目的・背景）

認証済みユーザーが自分の過去のケース（判決完了済み）を一覧・詳細閲覧できる機能を追加する。現状は進行中のケースページのみ存在し、過去の話し合いを振り返る手段がない。`/history` ページを新設し、既存の `/case/[id]` ページを判決閲覧用としてそのまま流用する。

スキーマ変更なし。新設ファイルは `app/history/page.tsx` の 1 ファイルのみ。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

今回 API Route の追加・変更はない。`/history` ページは Server Component として直接 Supabase クエリを発行する。既存の `/api/cases/[id]` は詳細表示に流用される（変更なし）。

---

## データモデル（DB スキーマ・型定義の変更）

### スキーマ変更

なし。既存の `cases.plaintiff_id` / `cases.defendant_id` でクエリが完結する。

### クエリ設計

`/history` ページで発行するクエリ（Server Component 内、`createSessionClient()` 使用）：

```sql
SELECT
  c.id, c.topic, c.phase, c.created_at,
  c.plaintiff_id, c.defendant_id, c.defendant_guest_name,
  pp.display_name AS plaintiff_name,
  dp.display_name AS defendant_name
FROM cases c
LEFT JOIN profiles pp ON pp.id = c.plaintiff_id
LEFT JOIN profiles dp ON dp.id = c.defendant_id
WHERE (c.plaintiff_id = :userId OR c.defendant_id = :userId)
  AND c.phase = 'verdict'
ORDER BY c.created_at DESC
```

Supabase JS SDK では FK エイリアス指定で双方に JOIN する（制約・前提条件参照）。

### TypeScript 型定義（lib/types.ts への追加）

```ts
export type HistoryCase = {
  id: string;           // ケース ID（/case/[id] へのリンクに使用）
  topic: string;        // 議題
  phase: string;        // フェーズ（常に 'verdict'）
  createdAt: string;    // 作成日時（ISO 8601）
  opponentName: string; // 相手の表示名（ゲスト名 or display_name）
};
```

`plaintiff_id` / `defendant_id` の UUID はサーバー側のみで使用し、`HistoryCase` 型には含めない。

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### `app/history/page.tsx`（新設）

**種別**: Server Component（`async` 関数）

**責務**:
1. `createSessionClient()` で `getUser()` を呼び出し、ログインユーザーの UUID を確定する
2. Supabase クエリで当該ユーザーが原告または被告（`defendant_id`）として参加した `phase = 'verdict'` のケースを取得する
3. 取得結果を `HistoryCase[]` に変換し、一覧として HTML レンダリングする

**UI 仕様**:
- ページタイトル: 「過去のケース」
- 一覧表示項目（各ケース行）:
  - `topic`（議題）
  - `opponentName`（相手の名前）
  - フェーズバッジ（「判決完了」と表示）
  - `createdAt`（作成日時、ロケール表示）
- 各行は `/case/[id]` へのリンク
- ケースが 0 件の場合は「まだ過去のケースはありません」などの空状態メッセージを表示する
- スタイルは既存 stone 系トーンに準拠、モバイルファースト

**opponent 名の決定ロジック（サーバー側）**:

```
if (user.id === case.plaintiff_id)
  → opponentName = defendant_guest_name ?? defendant_profile.display_name ?? "（不明）"
else
  → opponentName = plaintiff_profile.display_name ?? "（不明）"
```

### `/case/[id]`（変更なし）

既存ページをそのまま流用する。`verdict` フェーズのケースは発言フォームが自然に非表示になる前提（制約・前提条件参照）。

---

## セキュリティ設計（認証・認可・入力検証の方針）

### 認証ガード

- `middleware.ts` の保護対象パスリストに `/history` が含まれていることを確認する。含まれていない場合は追加する
- Server Component 内でも `getUser()` を呼び出し、ユーザー ID を確定してからクエリを発行する（middleware の保護と合わせて二重確認）

### データ漏洩防止

- クエリの WHERE 句を必ずサーバー側で適用する（RLS に委ねない方針、environment.md 規則に準拠）
- `plaintiff_id` / `defendant_id` の UUID はサーバー側でのみ使用し、クライアントに渡す `HistoryCase` 型には含めない。backlog MEDIUM-001（UUID 露出問題）の影響範囲を拡大しない
- `cases` テーブルは誰でも読めるが（ADR-003）、「自分のケースのみ」はアプリ層のフィルタ（WHERE 句）で保証する

### 入力検証

新規ユーザー入力なし（読み取り専用ページ）。

---

## 制約・前提条件

### ゲストユーザーの除外

`defendant_guest_name` を使って参加したゲストユーザーは永続的なアカウント ID を持たない。そのため `/history` への参照対象から除外する。`defendant_id IS NULL`（ゲスト参加）のケースは `OR defendant_id = userId` の条件にマッチしないため自動的に除外される。追加フィルタは不要。これは ADR-002 および task.md の明示的な割り切りである。

### 表示対象フェーズ

`phase = 'verdict'` の完了済みケースのみを表示対象とする。進行中のケース（waiting / opening / argument / closing / judging）は除外する。

### `/case/[id]` の observer モード

既存の `/case/[id]` ページが `verdict` フェーズのケースを表示する際に発言フォームが自然に非表示になる動作が確実であることを前提とする。

> **注意事項（確認要）**: 実装コードで `verdict` フェーズ時のフォーム非表示が保証されているかを確認すること。保証されていない場合は、既存ページの phase 判定ロジックで対応する（新規ページの作成は行わない。task.md 明示）。

### Supabase JS SDK の二重 FK JOIN

`plaintiff_id` と `defendant_id` はどちらも `profiles` テーブルへの FK が 2 つある。Supabase JS SDK でこれを書く場合は FK 制約名によるエイリアスが必要（例: `profiles!cases_plaintiff_id_fkey`）。

> **注意事項（確認要）**: `supabase/schema.sql` に FK 制約が定義されているかを実装前に確認すること。FK 制約がない場合は二段クエリ（ケース取得 → プロフィール取得）で対応すること。

### ページネーション

スコープ外（task.md 明示）。件数が少ない前提でスクロール対応とする。
