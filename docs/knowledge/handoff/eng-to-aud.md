# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-003（法律作成機能）
**日時**: 2026-05-26

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260526000003_feat003_laws.sql` | 新規 | 5テーブル作成・RLS・インデックス・GRANT |
| `lib/types.ts` | 変更 | Law / LawMember / LawInvitation / LawProposal / LawProposalVote 型を追加 |
| `lib/laws/consensus.ts` | 新規 | 合意チェック共通ロジック（投票 API・退会 API から呼び出し） |
| `middleware.ts` | 変更 | `/laws` を保護対象パスプレフィックスに追加 |
| `app/api/laws/route.ts` | 新規 | GET（一覧）・POST（作成） |
| `app/api/laws/[id]/route.ts` | 新規 | GET（詳細。メンバーチェック含む） |
| `app/api/laws/[id]/invitations/route.ts` | 新規 | POST（招待作成） |
| `app/api/laws/[id]/invitations/[invId]/route.ts` | 新規 | PATCH（招待承認/拒否） |
| `app/api/laws/[id]/members/me/route.ts` | 新規 | DELETE（退会） |
| `app/api/laws/[id]/owner/route.ts` | 新規 | PATCH（オーナー権移譲） |
| `app/api/laws/[id]/proposals/route.ts` | 新規 | POST（改定案・削除提案の作成） |
| `app/api/laws/[id]/proposals/[propId]/route.ts` | 新規 | DELETE（提案取り下げ） |
| `app/api/laws/[id]/proposals/[propId]/votes/route.ts` | 新規 | POST（投票・合意チェック） |
| `app/laws/page.tsx` | 新規 | Server Component: 法律一覧 |
| `app/laws/new/page.tsx` | 新規 | Server Component: 法律作成ページ |
| `app/laws/new/_components/LawForm.tsx` | 新規 | Client Component: 作成フォーム |
| `app/laws/[id]/page.tsx` | 新規 | Server Component: 法律詳細 |
| `app/laws/[id]/_components/ArticleSection.tsx` | 新規 | 条文表示 |
| `app/laws/[id]/_components/MemberList.tsx` | 新規 | Client Component: メンバー一覧・退会・移譲 |
| `app/laws/[id]/_components/OwnerTransferModal.tsx` | 新規 | Client Component: オーナー移譲モーダル |
| `app/laws/[id]/_components/ProposalPanel.tsx` | 新規 | Client Component: 提案表示・投票・取り下げ・提出 |
| `app/laws/[id]/_components/InvitePanel.tsx` | 新規 | Client Component: フレンド検索・招待 |

---

## 実装上の判断・設計書からの逸脱

### 設計書に準拠した点

- `createSessionClient()` で認証確認、書き込みは全て `createAdminClient()` 経由
- RLS は SELECT のみ定義、WRITE はアプリ層で制御
- `anon` への GRANT は付与していない（LOW-001 の教訓）
- `law_proposals` の `UNIQUE(law_id)` 制約で同時提案排他。23505 エラーは 409 でハンドル
- 退会処理では「投票削除 → メンバー削除 → 合意チェック」の順序を守っている（設計書の注意事項に準拠）

### 設計書からの軽微な変更

- **`GET /api/laws` の実装**: 設計書は「JOIN で一括取得」と示唆しているが、Supabase クライアントの制約上、複数クエリ（一覧・メンバー数・提案有無・オーナー名）に分割して取得している。機能的な差異はない。
- **`InvitePanel` の既存メンバー/招待済みフィルタ**: 設計書は「UI 側でフィルタまたは disabled 表示」と記載。実装では disabled ではなくラベル（「メンバー済み」「招待済み」）を表示し、ボタンを非表示にするアプローチを採用した。操作は完全に遮断されている。
- **`lib/laws/consensus.ts` の新設**: 合意チェックロジックを投票 API と退会 API の両方から呼び出すため、共通ヘルパーとして切り出した。設計書には記載なかったが DRY 原則に従い実施。

---

## テスタ・オーディへの注意点

### 事前確認（テスト前必須）

1. **DBマイグレーション未実行**: `supabase/migrations/20260526000003_feat003_laws.sql` を本番/ローカル Supabase に適用してからテストすること。
2. **フレンド関係の前提**: 招待テストは、招待者と被招待者が `friend_requests` で `status = 'accepted'` のレコードを持つことが前提。FEAT-002 Phase 2 が適用済みであることを確認。

### 重点確認ポイント

#### 認証・認可

- 未認証時に全 API エンドポイントが 401 を返すこと
- 非メンバーが `GET /api/laws/[id]` にアクセスすると 403 になること
- オーナー以外が招待・削除提案・提案取り下げ・オーナー移譲を試みると 403 になること

#### バリデーション

- `name` が空文字 / 101文字以上 → POST /api/laws が 400
- `article` が空文字 / 2001文字以上 → 400
- `proposal_type` が `amendment` / `deletion` 以外 → 400
- `amendment` 時に `proposed_article` が空 → 400

#### 合意チェック

- 全メンバーが承認したとき、amendment 提案が実行されて `laws.article` が更新されること（提案レコードが削除されること）
- 全メンバーが承認したとき、deletion 提案が実行されて `laws` レコードが削除されること（CASCADE でメンバー・招待・提案・投票が全消去されること）
- 同一メンバーが再投票すると UPSERT で上書きされること（重複レコードが生じないこと）

#### 退会時の合意チェック

- 退会時に進行中の提案がある場合、退会メンバーの投票が削除された後に合意チェックが走ること
- 退会後に残存メンバー全員の承認が揃っている場合、自動的に提案が適用されること

#### 排他制御

- 既存提案がある状態で新規提案を作成しようとすると 409 になること（`UNIQUE(law_id)` 制約）

#### セキュリティ観点

- `invitee_id` / `new_owner_id` が UUID 形式でないリクエストは 400 で弾かれること
- フレンドでないユーザーへの招待は 409 になること
- 他人の招待（自分が invitee でない）への PATCH は 403 になること

---

## 今回の修正内容（監査不合格対応 commit: 0063fa0）

### [解決済み] HIGH-001: /laws ページに pending 招待セクションが存在しない

**症状**: 招待通知の受信 UI が `/laws/[id]` にしかなく、URL を知らなければ到達不能。

**修正**:
- `app/laws/_components/PendingInvitations.tsx` を新規作成（Client Component）
  - `invitee_id = user.id AND status = 'pending'` の招待を表示
  - 承認ボタン → `PATCH /api/laws/[id]/invitations/[invId]` に `{ status: "accepted" }`
  - 拒否ボタン → 同 API に `{ status: "rejected" }`
  - 操作後に `router.refresh()` でページ更新
- `app/laws/page.tsx` に招待データ取得ロジックと `<PendingInvitations>` レンダリングを追加
  - 法律一覧の上部（ヘッダーの直下）に「届いた招待」セクションを配置
  - 招待が 0 件の場合はコンポーネント自体が `null` を返す

**注意**: `/laws/[id]/page.tsx` の非メンバー向け InvitationAccept は**そのまま残している**（直リンクアクセスへの対応）。

### [解決済み] MEDIUM-002: PATCH invitations ルートに lawId バリデーションが不足

**修正**: `app/api/laws/[id]/invitations/[invId]/route.ts` に `.eq("law_id", lawId)` を追加。
異なる法律の invId が指定されても招待が見つからず 404 を返す。

### [解決済み] HIGH-001/MEDIUM-001: E2E テストが soft assertion のため不合格を検出できない

**修正内容**:
- L02 (lines 72-76): `if (isVisible)` → `await expect().toBeVisible()`
- L03 (lines 119-122): 同上 + `goto(lawUrl)` → `goto('/laws')` に変更（pending 招待は /laws に表示されるため）
- L03 投票フロー (lines 139-141): `if (isVisible)` → `await expect().toBeVisible()`、`pageB.reload()` → `pageB.goto(lawUrl)` に変更（承認後 B は /laws にいるので投票前に法律詳細へ遷移が必要）
- L03 条文確認 (lines 147-150): `if (isVisible) { // 成功 }` → `await expect().toBeVisible()`
- L04 (lines 189-193): `if (isVisible)` → `await expect().toBeVisible()`

---

## 既知の問題・要確認事項（修正済み含む）

### [解決済み] InvitePanel の招待検索（commit: 11e471e）

`/api/users/search` が既存フレンドを除外する問題。`/api/friends` + ローカルフィルタに変更済み。

### [解決済み] CRITICAL-L02: 招待承認 UI の欠落（commit: 202e618）

**症状**: 招待された非メンバーが `/laws/[id]` にアクセスすると `/laws` へリダイレクトされ、承認ボタンが表示されなかった。

**修正内容**:
- `app/laws/[id]/page.tsx`: 非メンバーアクセス時に pending 招待の有無を確認。招待があれば承認 UI（InvitationAccept コンポーネント）を表示。招待がない場合のみ `/laws` へリダイレクト。
- `app/laws/[id]/_components/InvitationAccept.tsx`: 招待承認/拒否 UI（新規）。承認後は `router.refresh()` で同ページをメンバーとして再レンダリング。

### [解決済み] CRITICAL-L04: オーナー移譲ボタンが disabled（commit: 202e618 の間接修正）

**根本原因**: L02 未修正により招待者がメンバーに追加されず、OwnerTransferModal の `candidates.length === 0` でボタンが disabled だった。L02 修正により間接解決。

### [解決済み] MemberList テキストフォーマット（commit: 202e618）

「メンバー (X人)」→「メンバー X人」。E2E テスト正規表現 `/メンバー\s+\d+人/` にマッチするよう修正。

---

## 未実装・スコープ外にしたこと

| 項目 | 理由 |
|---|---|
| 法律コメント・チャット機能 | task.md でスコープ外 |
| 法律の公開 Hub（FEAT-004） | task.md でスコープ外 |
| メール通知（招待・合意成立） | task.md でスコープ外 |
| 改定案の複数同時提出 | task.md でスコープ外 |
| 部分改定 UI | task.md でスコープ外 |
| 合意チェックの PostgreSQL 関数化 | design.md にて「少人数ユースケースのためアプリ層で対応」と明記されているため |
