# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

FEAT-003（法律作成機能）監査不合格の修正。

**修正内容（3件）:**

### FIX-A: `/laws/page.tsx` に pending 招待セクションを追加（HIGH-001 対応・最重要）

`app/laws/page.tsx` の Server Component 部分に以下を追加する。
前回のエンジニアが `/laws/[id]/page.tsx` に実装したが、ユーザーはその URL を知らなければ到達不能。本来の実装先は `/laws/page.tsx`。

実装仕様:
- `law_invitations` から `invitee_id = user.id AND status = 'pending'` のレコードを取得
- 関連する `laws.name` と、`laws.owner_id` → `profiles.display_name` を取得して表示
- 「届いた招待」セクションを法律一覧の上部に配置する
- 承認・拒否ボタンは `app/laws/_components/PendingInvitations.tsx` として切り出す（Client Component）
- 承認ボタン → `PATCH /api/laws/[id]/invitations/[invId]` に `{ "status": "accepted" }` を送信
- 拒否ボタン → 同 API に `{ "status": "rejected" }` を送信
- 操作後に `router.refresh()` でページをリフレッシュ

`app/laws/[id]/page.tsx` の非メンバー処理は**そのまま残す**（直リンクからのアクセスにも対応するため）。

### FIX-B: E2E テストの assertion を hard assertion に修正（HIGH-001/MEDIUM-001 対応）

`tests/e2e/laws.spec.ts` の以下の `if (await xxx.isVisible(...))` 条件分岐を `await expect(xxx).toBeVisible(...)` に変更する。

| 行 | テスト | 修正内容 |
|----|--------|---------|
| 72–76 | L02 | `if (await acceptBtn.isVisible(...))` → `await expect(acceptBtn).toBeVisible(...)` |
| 119–122 | L03 | 同様 |
| 139–141 | L03 | 同様 |
| 147–151 | L03 | 同様 |
| 189–193 | L04 | 同様 |

テストは FIX-A の実装後に `/laws` ページで招待ボタンを探すよう修正すること。

### FIX-C: PATCH invitations ルートに lawId バリデーションを追加（MEDIUM-002 対応）

`app/api/laws/[id]/invitations/[invId]/route.ts:10` を修正する。

```typescript
// 変更前
const { invId } = await params;

// 変更後
const { id: lawId, invId } = await params;
```

そして招待の検索クエリに `.eq("law_id", lawId)` を追加する。

```typescript
const { data: invitation } = await admin
  .from("law_invitations")
  .select("id, law_id, invitee_id, status")
  .eq("id", invId)
  .eq("law_id", lawId)  // この行を追加
  .maybeSingle();
```

---

## 概要

ユーザーが「法律」（オリジナルルールセット）を作成・管理できる機能。
フレンド間でルールを施行し、改定案を合議で決める仕組みを提供する。

---

## 機能要件

### L-1. 法律の作成

- ログイン済みユーザー（以後「オーナー」）が法律を作成できる
- 作成時に「法律名」（必須・最大 100 文字）と「条文」（必須・最大 2000 文字）を入力する
- 作成者が自動的にオーナー兼メンバーになる

### L-2. メンバー招待

- オーナーは自分のフレンドを法律に招待できる
- 招待されたフレンドは承認 / 拒否を選択できる
- 承認するとメンバーになり、その法律のルールに参加する

### L-3. 改定案の提出・合意

- メンバー（オーナー含む）は改定案を提出できる
- 改定案には「変更後の条文」を記載する
- **全メンバーの合意**（全員が承認）で改定が成立し、条文が更新される
- 1 つの法律に同時に存在できる改定案は 1 件のみ
- 改定案はオーナーが取り下げ（削除）できる

### L-4. オーナー権の移譲

- オーナーは他のメンバーにオーナー権を移譲できる
- 移譲後、前オーナーは一般メンバーになる

### L-5. 退会

- オーナー以外のメンバーは自由に退会できる
- 退会すると進行中の改定案の合意票も無効になる

### L-6. 法律の削除

- オーナーは削除を提案できる
- **全メンバーの合意**で法律が削除される

---

## 画面

| 画面 | パス | 認証 |
|------|------|------|
| 法律一覧（自分が参加中） | `/laws` | 必須 |
| 法律詳細・条文・改定案 | `/laws/[id]` | 必須（メンバーのみ閲覧） |
| 法律作成 | `/laws/new` | 必須 |

---

## スコープ外

- 法律のコメント・チャット機能
- 法律の公開 Hub（FEAT-004）
- メール通知
- 改定案の複数同時提出
- 部分改定（条文の一部だけ変更するUI）
