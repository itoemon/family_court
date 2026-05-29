# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。**既存の設計（FEAT-001〜FEAT-003、MEDIUM-001、過去 PR の設計など）を絶対に削除・短縮しないこと**。本タスクの内容は `design.md` の末尾に新規セクションとして **追記** すること（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは LOW バッチ（監査由来の品質改善 2 件）の対応である。RLS / migration / DB スキーマには **一切手を加えない**。アプリケーションコードのみの修正である。

## 今回のタスク

監査由来の LOW 指摘 2 件をまとめて対応する **設計と実装**。

1. **LOW-001**: URL パスパラメータ（`lawId` / `invId` / `propId` 等）の UUID バリデーション未実施
2. **LOW-002**: `app/laws/_components/PendingInvitations.tsx` で `fetch` のレスポンスステータスを検査していない

**由来**: `docs/knowledge/archive/audit-log/audit_20260526_200752.md` の LOW-001 / LOW-002

---

### 背景

#### LOW-001（UUID バリデーション）

- 全 API ルートの `lawId`・`invId`・`propId` がリクエスト URL から取得した生の文字列のまま Supabase クエリの `.eq("id", ...)` に渡されている。
- リクエストボディ側の UUID（`invitee_id` / `new_owner_id` / `receiver_id`）は既に `UUID_REGEX` で検証済みだが、**パスパラメータ側は未検証**。
- Supabase は UUID 型カラムへの非 UUID 値を PostgreSQL エラーとして返すため、現時点で実データ操作は発生しないが、PostgreSQL エラーが 500 として漏洩しうる（エラーレスポンス形式の不統一）。
- さらに `UUID_REGEX` は 3 ファイル（`app/api/laws/[id]/invitations/route.ts`、`app/api/friends/requests/route.ts`、`app/api/laws/[id]/owner/route.ts`）に重複定義されている。

#### LOW-002（fetch ステータス検査）

- `PendingInvitations.tsx` の `respond()`（line 23-35 付近）は `fetch(...)` の戻り値（`Response`）を検査せず、常に `router.refresh()` を実行している。
- API が 403 / 404 / 500 を返してもリフレッシュが走り、ユーザーはエラーを受け取れない。招待が残ったまま表示され「なぜ消えないのか」が伝わらず連打を誘発する。

---

### 解決すべき設計上の課題

1. **`UUID_REGEX` の共通化**
   - 重複定義を解消し、共通ユーティリティ（`lib/utils.ts` 新規 もしくは既存 `lib/text-utils.ts`）に `UUID_REGEX` と `isUuid()` ヘルパーを切り出す。配置先は既存 lib の構成に合わせてアーキが決定する。
   - 既存 3 ファイルの重複定義を共通ユーティリティ参照に置き換える（挙動は不変、リグレッション禁止）。

2. **パスパラメータ UUID バリデーションの追加範囲**
   - `app/api/**/route.ts` のうち、UUID 型カラムを参照するパスパラメータ（`lawId` / `invId` / `propId` / `cases` の `[id]` 等）を持つルートの **先頭**で UUID 形式チェックを行い、不正なら 400 を返す。
   - 対象ルートをアーキが列挙し、各 HTTP メソッドハンドラ先頭にガードを置く方針を確定する。ゲスト経路・認証経路の双方で漏れなく適用すること。
   - 既存の正常系（正しい UUID）の挙動は一切変えない。

3. **`PendingInvitations.tsx` の fetch ステータス検査**
   - `respond()` で `res.ok` を検査し、失敗時はユーザーにエラーを表示する（既存のエラー表示パターン・配色に合わせる。被告/エラーの `rose-*`、プライマリ `brand-700/800` のルール厳守）。
   - 成功時のみ `router.refresh()` を呼ぶ。失敗時の `processingId` リセット（`finally`）は維持。
   - エラー表示 UI は既存コンポーネント（ErrorBanner 等があれば再利用）に合わせる。なければ最小限のインライン表示。

---

### スコープ外（重要）

- **RLS / migration / DB スキーマの変更は一切行わない**（本タスクはアプリコードのみ）
- `profiles` テーブル関連の変更
- backlog の他 LOW 項目（`package.json` 変更ログ、`@upstash/core-analytics` 検証）
- FEAT-004（法案 Hub）/ MON-001 / MON-002
- リクエストボディ側 UUID 検証の挙動変更（既存のまま維持。共通化で参照先を変えるのは可）

---

### 期待する設計成果物

#### 1. `docs/knowledge/design.md` への **追記**（既存内容は保持）

末尾に以下のセクションを **追加** する（既存の章は一切変更しないこと）。

```
## LOW バッチ対応: UUID バリデーション共通化 + fetch ステータス検査

### 概要
（2 件の指摘の目的・背景）

### 影響範囲
- lib/<共通ユーティリティ>（UUID_REGEX / isUuid 切り出し）
- app/api/**/route.ts（パスパラメータ UUID ガード追加対象を列挙）
- app/laws/_components/PendingInvitations.tsx

### LOW-001 設計
- UUID_REGEX 共通化の配置と公開 API（isUuid 等）
- パスパラメータ検証の適用ルート一覧と各メソッドのガード方針
- 400 レスポンスの形式（既存の 400 と統一）

### LOW-002 設計
- respond() のステータス検査フローとエラー表示方針（配色ルール遵守）

### 制約・前提条件
- DB / RLS は触らない
- 正常系の挙動を一切変えない
```

#### 2. `docs/knowledge/handoff/arch-to-eng.md` の更新

ビルドへの引き継ぎメモ。共通化の手順、対象ルートの grep 手順、リグレッション確認シナリオを記載する。DB を触らないことを明示する。

---

### 制約・前提

- **`design.md` は永続資料**: 既存セクション（FEAT-001〜FEAT-003、MEDIUM-001 等）は **絶対に削除しない**。末尾に追記すること。
- RLS / migration / DB スキーマは一切変更しない（アプリコードのみ）
- 正常系（正しい UUID・成功レスポンス）の挙動を一切変えないこと
- 配色ルール厳守（エラーは `rose-*`、プライマリは `brand-700/800`、`brand-500` 不使用）
- ボディ側 UUID 検証は共通化のみ可、検証ロジック自体は不変

---

### 関連ファイル

- `app/api/laws/[id]/invitations/route.ts`（UUID_REGEX 重複定義元、共通化対象）
- `app/api/friends/requests/route.ts`（UUID_REGEX 重複定義元、共通化対象）
- `app/api/laws/[id]/owner/route.ts`（UUID_REGEX 重複定義元、共通化対象）
- `app/api/**/route.ts`（パスパラメータ UUID ガード追加対象、アーキが列挙）
- `app/laws/_components/PendingInvitations.tsx`（fetch ステータス検査追加）
- `lib/text-utils.ts`（既存ユーティリティ、共通化の配置候補）
- `docs/knowledge/design.md`（設計書、**末尾に追記**）
- `docs/knowledge/archive/audit-log/audit_20260526_200752.md`（指摘元、参照のみ）
