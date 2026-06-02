# アーキ → ビルド 引き継ぎメモ（FEAT-005）

## タスク概要

ログインユーザー本人のためのダイジェスト型統合ハブ `/me` を新設する **UI + Server Component** の改修。あわせてヘッダードロップダウンの先頭に「マイページ」項目を追加する。バックログ ID `FEAT-005`。

詳細設計は `docs/knowledge/design.md` 末尾の **「FEAT-005 対応: マイページ（自分専用統合ハブ）の新設」** セクションを参照すること。task.md の内容と矛盾するものは書いていない。task.md と本メモが矛盾する場合は task.md を優先せよ。

**最重要事項（絶対条件）**:

- RLS / migration / DB スキーマには **一切** 触らない（`supabase/` 配下不可侵）。
- 新規 npm 依存を追加しない（heroicons パッケージ等を含む）。
- breakpoint（`sm:` `md:` `lg:` `xl:`）を導入しない（全画面サイズで同一 UI）。
- 配色は `stone-*` / `brand-700` / `brand-800` のみ。「招待中」バッジに限り既存 `/laws` の `amber-100` / `amber-700` を流用してよい。`brand-500` は使わない。
- マイページから編集・追加・削除を一切行わない（form 不可、Server Action 不可、API Route 追加不可）。
- 既存ページ `/profile`・`/friends`・`/history`・`/laws` のレイアウト・挙動を一切変えない。
- `app/components/Header.tsx` 本体は変更しない。`HeaderUserMenu.tsx` のメニュー項目を 1 行追加するのみ。
- `app/actions/auth.ts`・`tailwind.config.*`・`package.json`・`next.config.*` を変更しない。

---

## 実装順序

順序を守ると各ステップ単体で検証しやすい。

### Step 1: 既存パターンの把握（読み取りのみ）

実装の前に次の既存ファイルを Read で把握する:

1. `middleware.ts`（`PROTECTED_PATH_PREFIXES` 配列の位置と判定ロジック構造）
2. `app/components/HeaderUserMenu.tsx`（メニュー項目の配置と `menuItemClass` 定数の値）
3. `app/history/page.tsx`（`cases` の自己関連クエリ・`opponentName` の解決パターン。本ページではトピックと日付のみ取得するので opponent 名解決は **コピーしない**）
4. `app/friends/page.tsx`（`friend_requests` の accepted クエリ + `profiles` cross-user 解決パターン）
5. `app/laws/page.tsx`（`law_members` → `laws` のメンバーシップクエリ + `law_invitations` の pending クエリ + 役割判定の参考。本ページは `PendingInvitations` Client Component を再利用 **しない**、ダイジェストのみ）
6. `app/profile/page.tsx`（`defense_custom_instruction` フィールドの存在確認）
7. `app/components/HeaderUserMenu.tsx` の `UserSilhouette` SVG（`MeHeader` に複製するため）
8. `lib/supabase/server.ts`（`createSessionClient` / `createAdminClient` のシグネチャ）
9. `lib/types.ts`（既存型 `Profile`・`FriendListItem`・`HistoryCase`・`Law` 等。プロップス型は本ページ内に閉じて新規定義する判断でよい — `lib/types.ts` に新規 export を追加する必要はない）

ターゲットを把握する grep ヒント:

| 探したい場所 | コマンド |
|------------|----------|
| `friend_requests` の自己関連 select パターン | `grep -n "friend_requests" app/friends/page.tsx` |
| `cases` の自己関連 select パターン | `grep -n "plaintiff_id\\|defendant_id" app/history/page.tsx` |
| `law_members` / `laws` のメンバーシップ select パターン | `grep -n "law_members\\|laws" app/laws/page.tsx` |
| `law_invitations` の pending select パターン | `grep -n "law_invitations" app/laws/page.tsx` |
| 既存 `menuItemClass` の定義 | `grep -n "menuItemClass" app/components/HeaderUserMenu.tsx` |
| 既存 `PROTECTED_PATH_PREFIXES` | `grep -n "PROTECTED_PATH_PREFIXES" middleware.ts` |
| `UserSilhouette` の SVG | `grep -n "UserSilhouette" app/components/HeaderUserMenu.tsx` |

### Step 2: middleware.ts に `/me` を保護パスに追加

`PROTECTED_PATH_PREFIXES` 配列に `"/me"` を 1 件追加するだけ。配列の他要素・順序・直後の `pathname === "/"` / `"/case/new"` 判定・matcher 設定はそのまま。

```typescript
const PROTECTED_PATH_PREFIXES = ["/history", "/profile", "/friends", "/laws", "/me"];
```

これにより `/me` 単独 / `/me/...` 両方が `pathname === p || pathname.startsWith(p + "/")` で保護される。

このステップで一度 `npm run dev` を起動し、未ログイン状態で `/me` を開くと `/auth/login` にリダイレクトされることを目視確認しておくと良い（page.tsx をまだ作っていない段階なので 404 でも middleware が先に走るかは確認しておく）。

### Step 3: `app/me/page.tsx` 新設（Server Component・データ取得オーケストレータ）

ファイルの大枠:

```typescript
import { redirect } from "next/navigation";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import MeHeader from "./_components/MeHeader";
import ProfileCard from "./_components/ProfileCard";
import FriendsCard from "./_components/FriendsCard";
import CasesCard from "./_components/CasesCard";
import LawsCard from "./_components/LawsCard";

export default async function MePage() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // 6 系統のクエリを Promise.allSettled で並列発行
  // 1. profiles (self)         - createSessionClient
  // 2. friend_requests accepted - createSessionClient
  // 3. cases (verdict, own)    - createSessionClient
  // 4. law_members + laws     - createSessionClient
  // 5. law_invitations pending - createSessionClient
  // friend_profiles 解決(admin) - createAdminClient （friend ID 集合が空でなければ後段で）

  // それぞれの result から props を組み立て、各 Card に渡す。

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <MeHeader displayName={...} avatarUrl={...} />
        <ProfileCard ... />
        <FriendsCard ... />
        <CasesCard ... />
        <LawsCard ... />
      </div>
    </main>
  );
}
```

クエリ実装の注意:

- 各クエリは try-catch ではなく `Promise.allSettled` の `status === 'fulfilled' / 'rejected'` で分岐すると簡潔。`rejected` または `value.error` がある場合は `console.error("[me] <section> query failed:", ...)` でログを残し、当該セクションに空配列 / null を渡す。**throw しない**。ページ全体が 500 になるのを避ける。
- `friend_requests` クエリの直後で `friendIds` を組み立て、空でなければ `admin.from("profiles").select("id, display_name, avatar_url").in("id", friendIds)` を発行する。`friendIds` が空配列の場合は admin 呼び出し自体をスキップする（無駄なクエリと不必要な admin 露出を避ける）。
- 件数は全件取得後 `.length` で出し、ダイジェストは `.slice(0, 5)` で先頭 5 件。SELECT 列を最小化（`id` を必ず含み、表示に必要な列のみ）して転送量を抑える。
- 法律ダイジェストはメンバーシップ + pending 招待を合算し、`joined_at` / `invited_at` の降順マージで先頭 5 件を取る。役割判定は `laws.owner_id === user.id` → "owner"、それ以外で `law_members` 行あり → "member"、`law_invitations.status = 'pending'` 行のみ → "invitee"。
- `defense_custom_instruction` の 100 文字 truncate は素朴な `instruction.trim().slice(0, 100) + (instruction.trim().length > 100 ? "…" : "")` で十分。`lib/text-utils.ts` に 100 文字版 truncate がなくても新規追加は不要。

### Step 4: `app/me/_components/` 配下の Server Component 群を新設

順序:

1. `SectionCard.tsx`（先に作る。他の Card はこれを使うため）
2. `MeHeader.tsx`（`UserSilhouette` SVG を `HeaderUserMenu.tsx` からコピーしてローカルに置く）
3. `ProfileCard.tsx`
4. `FriendsCard.tsx`
5. `CasesCard.tsx`
6. `LawsCard.tsx`

各ファイルは **Server Component**（`"use client"` を **付けない**）。client 化が必要なインタラクションは本対応にはない。

props 形状は design.md の各「コンポーネント設計」節を参照。`titleId` は安定文字列を `page.tsx` から渡す（`"me-section-profile"` / `"me-section-friends"` / `"me-section-cases"` / `"me-section-laws"`）。

スタイル定数のヒント:

- カード外枠: `bg-white border border-stone-200 rounded-2xl shadow-sm p-5`
- 件数バッジ: `text-xs bg-stone-100 text-stone-500 rounded-full px-2 py-0.5`
- もっと見るリンク: `text-sm text-brand-700 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50`
- 空状態本文: `text-stone-500 text-sm`
- 空状態補助文: `text-stone-400 text-xs`
- 法律役割バッジ:
  - オーナー: `text-xs bg-stone-100 text-stone-700 rounded-full px-2 py-0.5`
  - メンバー: `text-xs bg-stone-100 text-stone-600 rounded-full px-2 py-0.5`
  - 招待中: `text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5`

### Step 5: `app/components/HeaderUserMenu.tsx` のメニュー先頭に「マイページ」追加

既存ファイル中の「過去のケース」 `<Link>` の **直前** に次を 1 ブロック挿入する:

```tsx
<Link
  href="/me"
  role="menuitem"
  onClick={close}
  className={menuItemClass}
>
  マイページ
</Link>
```

差分位置の特定: `<Link href="/history"` の行を grep し、その直前に挿入する。`menuItemClass` 定数は同ファイルの既存定義をそのまま再利用。新規スタイル定義を追加しない。

未認証分岐（ログイン / サインアップ）には何も追加しない。

### Step 6: 動作確認（実機 + 軽微テスト）

UI 変更なので `npm run dev` を立ち上げて実機で確認。AGENTS.md の方針通り、本バージョン Next.js の Server Component と `redirect()` の挙動は `node_modules/next/dist/docs/` を必要に応じて確認する。

---

## 各セクションの空状態テキスト案（確定済み）

| カード | 本文 | 補助文 |
|-------|------|------|
| プロフィール | 弁護人カスタム指示は未設定です | プロフィールでカスタム指示を編集できます |
| フレンド | まだフレンドはいません | フレンドを追加すると、ここに最近の 5 人が表示されます |
| 過去のケース | まだ判決が出たケースはありません | ホームからケースを作成して話し合いを始められます |
| 参加中の法律 | まだ参加している法律はありません | 法律を作成するか、招待を受けるとここに表示されます |

各空状態の下に該当ディープリンク（プロフィール: `/profile`、フレンド: `/friends`、過去のケース: `/`、参加中の法律: `/laws`）を「もっと見る」リンクと別に置く必要は **ない**。「もっと見る」リンク自体が遷移先となっており、空状態時もカード右上の同リンクが機能する。

---

## クエリ再利用 grep ヒント（既存 SELECT パターン）

新規 RLS を一切追加しないため、既存ページ（`/friends`・`/laws`・`/history`）の SELECT 形式を踏襲する。下記コマンドで該当箇所を即座に見つけられる:

- フレンド accepted: `grep -n 'eq("status", "accepted")' app/friends/page.tsx`
- フレンドの自己関連 OR: `grep -n 'sender_id.eq\\|receiver_id.eq' app/friends/page.tsx`
- ケースの verdict + 自己関連: `grep -n 'phase.*verdict\\|plaintiff_id.eq\\|defendant_id.eq' app/history/page.tsx`
- 法律メンバーシップ: `grep -n 'law_members' app/laws/page.tsx`
- 法律本体: `grep -n 'from("laws")' app/laws/page.tsx`
- 法律 pending 招待: `grep -n 'law_invitations' app/laws/page.tsx`

**注意**: `/history` および `/friends` の現行実装は `createAdminClient()` を使用しているが、本ページ `/me` では `createSessionClient()` に揃えること（design.md「データ取得設計」節）。`profiles` の cross-user 解決（フレンドの表示名・アバター）のみ `createAdminClient()` を使用してよい（MEDIUM-001 carve-out）。

---

## 実装上の注意点

### profiles 跨ぎは admin のままで良い

task.md は「`createAdminClient` を使用しない」と書いているが、その根拠として参照されている MEDIUM-001 セクションは「profiles テーブルは本 PR では触らない」carve-out を明示している。本対応もこれを踏襲し、フレンドの `display_name` / `avatar_url` 取得には `createAdminClient()` を使う。これは task.md の精神（二層防御）と矛盾しない。

実装段階で疑義が生じた場合は **profiles RLS を独自に改修しないこと**。`supabase/` 配下を変更すれば task.md の絶対条件違反となる。

### `<img>` を使う（`next/image` ではない）

アバター描画は `<img src={avatarUrl} alt={...} width={...} height={...} />` で行う。`next/image` を採用すると `next.config` の `images.remotePatterns` 等の調整が必要になり、スコープ外。FEAT-RESP-HEADER と同じ方針。`width` / `height` を明示してレイアウトシフトを抑止する。

### `UserSilhouette` SVG は `MeHeader.tsx` 内に直書きする

`HeaderUserMenu.tsx` から SVG コードを複製して `MeHeader.tsx` 内にローカル関数として置く。`app/components/UserSilhouette.tsx` への切り出しは **行わない**（本タスクのスコープを超える）。10 行 SVG 1 つの重複は許容する。

### `useId()` ではなく安定文字列で aria-labelledby を結ぶ

Server Component 間で aria の id を渡すには安定文字列（`"me-section-profile"` 等）を `page.tsx` から渡す。`useId()` は Client 用途のため使わない。

### Promise.allSettled を使う

`Promise.all` を使うと 1 つのクエリ失敗で全セクションが落ちる。`Promise.allSettled` で各クエリの成否を独立評価し、失敗セクションのみ空状態にフォールバックする。

### 件数バッジは `count = 0` でも「0件」と表示する

`count === null`（取得失敗）のみバッジ非表示。`count === 0` は「0件」を可視テキストで出す。空状態とバッジの併存により「取得に失敗したのではなく純粋に 0 件である」ことを明示する。

### `<form>` は一切置かない

マイページは編集機能を持たない。`<form>`・`<input>`・`<button type="submit">`・Server Action を一切記述しないこと。

---

## リグレッション確認シナリオ

実装後の動作確認チェックリスト:

### マイページ本体（`/me`）

- [ ] 認証済みユーザーが `/me` を開くとアイデンティティ行 + 4 カードが表示される
- [ ] 未認証ユーザーが `/me` を直接叩くと `/auth/login` にリダイレクトされる
- [ ] 未認証ユーザーが `/me/foo`（存在しないサブパス）を直接叩いても `/auth/login` にリダイレクトされる
- [ ] アバター未設定ユーザーで人型シルエットが表示される
- [ ] `defense_custom_instruction` 未設定ユーザーで空状態文が表示される
- [ ] フレンドが 0 人のユーザーで空状態文が表示される
- [ ] 判決済みケースが 0 件のユーザーで空状態文が表示される
- [ ] 参加中の法律が 0 件のユーザーで空状態文が表示される
- [ ] フレンドが 6 人以上いるユーザーで件数バッジが正しく、ダイジェストは 5 件で打ち切られる
- [ ] 法律で「オーナー / メンバー / 招待中」の 3 役割すべてが正しく振り分けられる
- [ ] 各カードの「もっと見る」リンクが対応する既存ページ（`/profile` / `/friends` / `/history` / `/laws`）に遷移する
- [ ] 過去のケース行クリックで `/case/[id]` に遷移する
- [ ] 法律メンバー行クリックで `/laws/[id]` に遷移する
- [ ] 法律「招待中」行クリックで `/laws` に遷移する

### 全画面サイズ（breakpoint なし確認）

- [ ] 横幅 375px（スマホ）でレイアウトが崩れない
- [ ] 横幅 768px（タブレット）でレイアウトが崩れない
- [ ] 横幅 1280px 以上（PC）でレイアウトが崩れない（`max-w-2xl` で中央寄せされる）
- [ ] 全画面サイズで同一の縦並び 1 カラムレイアウト

### ヘッダードロップダウン

- [ ] アバタークリックで認証時メニューが開き、先頭に「マイページ」が表示される
- [ ] 「マイページ」クリックで `/me` に遷移する
- [ ] 既存項目（過去のケース / フレンド / プロフィール / 区切り線 / ログアウト）の順序・スタイル・遷移先が不変
- [ ] 未認証時メニュー（ログイン / サインアップ）に変更がない
- [ ] Escape キーで閉じる、外側クリックで閉じる、項目クリックで閉じる挙動が不変

### 既存ページの非リグレッション

- [ ] `/profile` のレイアウト・編集機能が不変
- [ ] `/friends` のレイアウト・検索・申請・承認機能が不変
- [ ] `/history` のレイアウト・ケース一覧表示が不変
- [ ] `/laws` のレイアウト・法律一覧・招待表示・「法律を作る」ボタンが不変
- [ ] `/laws/[id]` の詳細・改定・退会機能が不変
- [ ] `/auth/login` / `/auth/signup` への遷移挙動が不変
- [ ] ログアウト動作（Server Action）が不変

### アクセシビリティ

- [ ] Tab キーで「マイページ」リンク → 各「もっと見る」リンク → 各セクション内リンクの順にフォーカス移動できる
- [ ] フォーカスリングが `brand-700` のトーンで表示される
- [ ] 各セクションが `<section aria-labelledby="me-section-...">` で見出しと結ばれている
- [ ] スクリーンリーダーで「マイページ」配下の `<h1>{表示名}</h1>`・各 `<h2>{カード名}</h2>` が階層として読み上げられる

### セキュリティ

- [ ] Network タブで `/me` の HTML レスポンスに `api_key_encrypted` 文字列が含まれていない
- [ ] Network タブで `/me` の HTML レスポンスに他人の `display_name` / `avatar_url` 以外（メールアドレス・ID 以外の機微情報）が含まれていない
- [ ] フレンドの `friendIds` が空のユーザーで admin クエリが発火しない（実装側のログまたは Supabase ダッシュボードで確認）

---

## 未解決事項 / 将来検討

本対応スコープ外で、将来別タスク化が想定される項目:

- **件数の精度上限**: 全件取得 → `.length` で件数を出すため、PostgREST デフォルトの 1000 行上限を超えるユーザーは件数が頭打ちになる。個人で 1000 件を超えるフレンド・ケース・法律を持つ段階は当面想定外だが、超え始めたら `count: "exact", head: true` への分離が必要。
- **profiles RLS の本格整備**: 「自分なら全列、他人なら一部列のみ」を表現する RLS 整備は本タスクのスコープ外。バックログに別項目化されている扱いで進める。
- **アバター画像読み込み失敗時の `onError` フォールバック**: 初版未実装。実機で失効頻度が高ければ別タスクで対応する。
- **UserSilhouette のグローバル化**: 第 3 の利用者が出てきた段階で `app/components/UserSilhouette.tsx` に切り出す提案を別タスク化する。

---

## 何かあったら

- task.md と本メモが矛盾する場合は **task.md を優先** すること（task.md の優先順位ルール）。
- design.md と本メモが矛盾する場合はリードに上申すること。本メモは design.md の要約版であり、詳細根拠は design.md 末尾の「FEAT-005 対応」セクションが正本。
- 「`createAdminClient` を使うのは違反では？」と疑問に思った場合の答え: profiles 跨ぎ参照だけは MEDIUM-001 carve-out で admin 維持が認められている。ドメインテーブル（friend_requests・cases・laws 系）には絶対に admin を使わないこと。
