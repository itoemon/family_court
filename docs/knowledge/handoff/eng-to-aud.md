# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 過去ケース一覧・詳細閲覧機能の実装  
**日時**: 2026-05-24

---

## 実装上の判断・変更点

### 変更・追加ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `middleware.ts` | 変更 | `/history` を保護対象パスに追加 |
| `lib/types.ts` | 変更 | `HistoryCase` 型を追加 |
| `app/history/page.tsx` | 新設 | 過去ケース一覧 Server Component |

---

### `createAdminClient()` をデータクエリに使用（設計書からの逸脱）

設計書は `createSessionClient()` でクエリを発行するよう記述しているが、以下の理由で `createAdminClient()` を採用した。

`profiles` テーブルの RLS ポリシーが `auth.uid() = id` であり、session client では**自分のプロフィールしか読めない**。相手の `display_name` を取得するには RLS バイパスが必要。

対応：`createSessionClient()` → `getUser()` でユーザー認証（二重確認）、実データクエリは `createAdminClient()` で実行し、WHERE 句（`plaintiff_id = userId OR defendant_id = userId`）をアプリ層で適用。environment.md の「RLS に認可を委ねない・WHERE 句で保証」方針と一致している。

---

### FK エイリアス JOIN を使わず二段クエリを採用

`arch-to-eng.md` は FK エイリアス JOIN と二段クエリの両方を提示していた。

今回は二段クエリを採用した理由：
- `schema.sql` の FK 制約がインライン定義であり、PostgreSQL 自動生成の制約名（`cases_plaintiff_id_fkey`）が Supabase PostgREST で確実に解決されるかを実行時に確認できなかった
- 二段クエリは FK 名依存がなく確実に動作する

実装フロー：
1. `cases` を取得（plaintiff_id / defendant_id 込み）
2. 相手の UUID を収集し、`profiles.in(ids)` でバッチ取得
3. Map で結合して `HistoryCase` に変換

---

### ヘッダーへの `/history` ナビリンク追加は未実施

設計書・handoff メモのスコープに含まれていないため実施しなかった。現状、ユーザーが `/history` に辿り着くにはURL直打ちのみ。オーディが UX ギャップとして次タスクへのフィードバックを検討されたい。

---

## オーディへの注意点

### 重点確認ポイント

1. **認証ガード**: 未ログインで `/history` にアクセスすると `/auth/login` へリダイレクトされること（middleware + Server Component 両方で確認）。

2. **一覧表示**: ログイン済みで `phase = 'verdict'` かつ自分が原告または被告（`defendant_id`）のケースのみ表示されること。進行中のケース（waiting〜judging）が混入しないこと。

3. **相手の名前**: 
   - 自分が原告のとき → 被告のゲスト名（`defendant_guest_name`）、または被告の `display_name` が表示されること
   - 自分が被告のとき → 原告の `display_name` が表示されること
   - 名前が取得できない場合は「（不明）」と表示されること

4. **ゲストケースの除外**: `defendant_id IS NULL`（ゲスト参加）のケースは `defendant_id.eq.${userId}` にマッチしないため自覧に出ないこと。

5. **空状態**: 自分が参加した verdict ケースが 0 件のとき「まだ過去のケースはありません」が表示されること。

6. **詳細リンク**: 各行クリックで `/case/${id}` に遷移し、case ページ内のリダイレクトロジック（`phase === "verdict"` → `/case/${id}/verdict`）により verdict ページが表示されること。発言フォームが表示されないこと（verdict ページは読み取り専用）。

7. **セキュリティ**: `plaintiff_id` / `defendant_id` の UUID がクライアントに渡る `HistoryCase` 型に含まれていないこと。

### 既存ページへの影響

`/case/[id]/page.tsx` および `/case/[id]/verdict/page.tsx` への変更はなし。既存動作が壊れていないことを確認すること。

---

## 未実装・スコープ外

| 項目 | 理由 |
|---|---|
| ゲストユーザーの過去ケース参照 | 永続 ID なし。task.md 明示 |
| ページネーション | task.md 明示でスコープ外 |
| ヘッダーへの `/history` ナビリンク追加 | 設計書・handoff 未記載。次タスクで検討 |
| 二人のユーザー間のケース横断検索 | 別タスク |
| ケースの削除・非表示機能 | 別タスク |
| MEDIUM-001（UUID 公開）他バックログ | 既存バックログ |
