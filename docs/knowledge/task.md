# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。**既存の設計（FEAT-001〜FEAT-003、過去 PR の設計など）を絶対に削除・短縮しないこと**。本タスクの内容は `design.md` の末尾に新規セクションとして **追記** すること（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは `laws` テーブル系の RLS 整備のみが対象である。`profiles` テーブルの RLS / 列 GRANT には **一切手を加えない**（後述の理由を参照）。

## 今回のタスク

MEDIUM-001（FEAT-003 監査由来）対応の **設計**。`app/laws/page.tsx` と `app/laws/[id]/page.tsx` の Server Component が法律関連テーブル（`laws`, `law_members`, `law_invitations`, `law_proposals`, `law_proposal_votes`）を読む経路を、`createAdminClient()`（service_role / RLS バイパス）から `createSessionClient()`（authenticated / RLS 適用）へ切り替えるための RLS 設計とコンポーネント設計を確定する。

**由来**: `docs/knowledge/archive/audit-log/audit_20260526_200752.md` の MEDIUM-001

---

### 背景

- `app/laws/page.tsx` と `app/laws/[id]/page.tsx` は、認証確認後のすべての DB 読み取りに `createAdminClient()` を使用しており、RLS をバイパスしている。
- 現状は各クエリにアプリ層フィルタ（`.eq("invitee_id", user.id)` 等）が付いているためデータ漏洩は発生していないが、RLS による二重防御が効いていない。将来フィルタを誤って削除した場合、即座にデータが露出するリスクがある。
- `design.md`（FEAT-003 当時）の方針は「Server Component からの読み取りは `createSessionClient()` を使用し、RLS で保護する」。現在の実装はこの方針に反する。

---

### 解決すべき設計上の課題

1. **`laws` SELECT ポリシーの拡張**
   `/laws` の「届いた招待」セクションでは、非メンバーである invitee が法律の `name` を読む必要がある。`/laws/[id]` の非メンバー分岐（招待受諾画面）でも `laws.name` と `laws.article` を読みたい。現状の `laws_select_member` ポリシーは「メンバーのみ」なので invitee には `laws` が見えない。
   - 新ポリシー案: 「メンバー OR pending invitee 本人 OR 法律オーナー」
   - 既存ポリシー `laws_select_member` を `DROP POLICY IF EXISTS` してから新ポリシーを `CREATE POLICY` する

2. **`law_members`, `law_invitations`, `law_proposals`, `law_proposal_votes` の既存 SELECT ポリシー検証**
   既存ポリシー（`supabase/migrations/20260526000003_feat003_laws.sql`）で Server Component に必要な行が見えるかを設計書で検証する。不足があれば追加修正案を提示する。

3. **Server Component のクエリ書き換え方針**
   `app/laws/page.tsx` と `app/laws/[id]/page.tsx` のクエリを `createSessionClient()` 経由で書く実装案を設計書に明記する。アプリ層フィルタは二重防御として保持。

---

### スコープ外（重要）

- **`profiles` テーブルの RLS / 列 GRANT は一切触らない**
  - 理由: 列レベル GRANT は role 単位（authenticated/anon/service_role）であり、「本人なら全列 SELECT、他人なら一部列のみ SELECT」を表現できない。`app/page.tsx` および `app/profile/page.tsx`（Client Component）が `api_key_encrypted` や `defense_custom_instruction` を読んでおり、列 GRANT で機微情報を絞ると本人取得経路が壊れる。
  - 今回は `app/laws/page.tsx` と `app/laws/[id]/page.tsx` 内で `profiles` を読む箇所だけ **`createAdminClient()` のまま残す**。`law_*` テーブルの読み取りだけを `createSessionClient()` に切り替える。
  - `profiles` の RLS 整備自体は別 backlog 項目として後日扱う。
- backlog の他の LOW 項目（UUID バリデーション、`anon` GRANT 削除、FK 23503 ハンドル、PendingInvitations.tsx の fetch 検査、`package.json` 変更ログ、`@upstash/core-analytics` 検証）
- FEAT-004（法案 Hub）に関連する変更
- MON-001 / MON-002
- `app/laws/_components/PendingInvitations.tsx` の改修（backlog の別項目）

---

### 期待する設計成果物

#### 1. `docs/knowledge/design.md` への **追記**（既存内容は保持）

末尾に以下のセクションを **追加** する（既存の章は一切変更しないこと）。

```
## MEDIUM-001 対応: Server Component の RLS 経由化（FEAT-003 補強）

### 概要
（変更の目的・背景）

### 影響範囲
- app/laws/page.tsx
- app/laws/[id]/page.tsx
- supabase/migrations/<新規 1 枚>

### RLS 設計
- `laws` SELECT ポリシー新案（メンバー OR pending invitee OR 法律オーナー）
- 他法律系テーブル（`law_members` 他）の既存ポリシーで十分かの検証結果
- `profiles` は本 PR では触らない旨を明記

### コンポーネント設計
- `app/laws/page.tsx` のクエリ書き換え方針（law_* は session client、profiles は admin のまま）
- `app/laws/[id]/page.tsx` のクエリ書き換え方針

### migration 設計
- 新規 migration 1 枚（DROP/CREATE POLICY、冪等、BEGIN/COMMIT、ロールバック手順をコメントで記載）

### セキュリティ設計
- アプリ層フィルタは二重防御として保持
- API Routes の書き込みは引き続き service_role 経由（既存方針踏襲）
- `auth.getUser()` の null チェックは先頭で維持

### 制約・前提条件
- 過去 migration は applied 済み
- 既存メンバー閲覧 UX を一切壊さない
```

#### 2. `docs/knowledge/handoff/arch-to-eng.md` の更新

ビルドへの引き継ぎメモ。設計書だけで判断できない実装手順（ステップ順、grep の必要性、動作確認シナリオ）を記載する。`profiles` を触らないことを明示する。

---

### 制約・前提

- **`design.md` は永続資料**: 既存セクション（FEAT-001, FEAT-002 Phase 1/2, FEAT-003 等）は **絶対に削除しない**。新規セクションとして末尾に追記すること。
- 既存メンバーの閲覧 UX を一切壊さないこと
- `profiles` の RLS 整備は本 PR スコープ外。`laws` 系テーブルの RLS のみ強化する
- `search_users` 関数の挙動は維持
- 過去 migration（`20260526000003_feat003_laws.sql` 他）は applied 済みのため、新規 migration を 1 枚追加する形で対応
- アプリ層フィルタ（`.eq(...)`, `.in(...)`）はそのまま残す（二重防御）

---

### 関連ファイル

- `app/laws/page.tsx`（Server Component、要書き換え）
- `app/laws/[id]/page.tsx`（Server Component、要書き換え）
- `supabase/migrations/20260526000003_feat003_laws.sql`（既存 RLS、参照のみ）
- `docs/knowledge/design.md`（設計書、**末尾に追記**）
- `docs/knowledge/archive/audit-log/audit_20260526_200752.md`（指摘元、参照のみ）
