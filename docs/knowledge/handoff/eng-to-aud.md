# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-005 — マイページ（自分専用統合ハブ）の新設 + ヘッダー導線追加
**日時**: 2026-06-02
**ブランチ**: feature/20260602-165117

由来: `docs/backlog.md` の `[FEAT-005] マイページ（フレンド・過去のケース・プロフィール統合ハブ）`

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `middleware.ts` | 変更（1 行） | `PROTECTED_PATH_PREFIXES` 配列に `"/me"` を追加。判定ロジック・matcher は不変 |
| `app/me/page.tsx` | 新規（Server Component） | データ取得オーケストレータ。`Promise.allSettled` で 5 系統の SELECT を並列発行し、フレンド profile 解決のみ admin で別実行。各カードに props を渡してレンダリング |
| `app/me/_components/SectionCard.tsx` | 新規（Server Component） | 4 カード共通のレイアウトシェル。`<section aria-labelledby>` + タイトル + 件数バッジ + 「もっと見る」リンク |
| `app/me/_components/MeHeader.tsx` | 新規（Server Component） | ページ最上部のアイデンティティ行。中型アバター（`w-16 h-16`）+ 表示名 `<h1>` + プロフィール編集リンク |
| `app/me/_components/ProfileCard.tsx` | 新規（Server Component） | プロフィールカード。小アバター + 表示名 + 弁護人カスタム指示プレビュー（100 文字 truncate） |
| `app/me/_components/FriendsCard.tsx` | 新規（Server Component） | フレンドカード。件数バッジ + 直近 5 名のアバター + 表示名リスト |
| `app/me/_components/CasesCard.tsx` | 新規（Server Component） | 過去のケースカード。件数バッジ + 直近 5 件のトピック + 日付。各行クリックで `/case/[id]` 遷移 |
| `app/me/_components/LawsCard.tsx` | 新規（Server Component） | 参加中の法律カード。件数バッジ + 直近 5 件の法律名 + 役割バッジ（オーナー/メンバー/招待中） |
| `app/components/HeaderUserMenu.tsx` | 変更（1 ブロック追加） | 認証時メニュー先頭に「マイページ」`<Link href="/me">` を 1 項目追加。他項目・未認証メニューは完全に不変 |

**触っていないファイル（設計どおりスコープ外）**:

- `supabase/` 配下すべて（RLS / migration / DB スキーマ）
- `package.json` / `package-lock.json`（新規 npm 依存なし）
- `tailwind.config.*`（カラートークン追加なし）
- `app/components/Header.tsx`（ヘッダー本体・マウント方法不変）
- `app/profile/page.tsx` / `app/friends/page.tsx` / `app/history/page.tsx` / `app/laws/page.tsx`（参照のみ。本体は不変）
- `app/actions/auth.ts`（`logout` 不変）
- `lib/types.ts`（既存型を使用するのみ。新規型 export は追加しない）

---

## 実装上の判断・設計書からの逸脱

設計書（`docs/knowledge/design.md`「FEAT-005 対応」）および `arch-to-eng.md` に忠実に実装した。**設計からの逸脱なし**。実装段階で判断した点を以下に列挙する。

1. **`createSessionClient` vs `createAdminClient` の使い分け**: 設計（および arch-to-eng.md「実装上の注意点」）に従い、ドメインテーブル（`profiles[self]` / `friend_requests` / `cases` / `law_members` / `laws` / `law_invitations`）はすべて `createSessionClient`。`profiles` の **フレンド分の他人行**（最大 5 件）の `display_name` / `avatar_url` 解決のみ `createAdminClient` を使う（MEDIUM-001 carve-out）。`friendIds` が空配列の場合は admin クエリを発行しない（早期 return）。

2. **`Promise.allSettled` を採用**: 1 つのクエリ失敗で全ページが落ちる挙動を避けるため `Promise.allSettled` を採用。各セクションは失敗時 `console.error("[me] <section> ...")` を残し、当該セクションのみ「空状態」または `count === null`（バッジ非表示）にフォールバックする。

3. **フレンド profile 解決は `Promise.allSettled` の外で実行**: `friend_requests` の結果に依存して `friendIds` が決まる構造のため、並列化はせず逐次実行とした。空配列なら admin 呼び出し自体をスキップ。

4. **`defense_custom_instruction` の 100 文字 truncate**: `lib/text-utils.ts` に既存 truncate は確認したが 100 文字版がない（および新規ユーティリティ追加は不要との設計指針）ため、`page.tsx` 内のローカル関数 `truncateInstruction()` で `.trim()` → `.slice(0, 100)` → 100 文字超なら末尾 `…` を付加する素朴な実装を採用。

5. **件数バッジ表示ルール**: `count === 0` でも「0件」と表示。取得失敗（`count === null`）のみバッジ非表示（`SectionCard.tsx` 内の `showBadge` 判定で `null`/`undefined` を弾く）。設計の「取得失敗との区別を明確化」方針に整合。

6. **法律ダイジェストの「招待」と「メンバーシップ」の重複排除**: 仕様上、メンバーになったあと招待が `accepted` になるため通常は重複しないが、データ整合性が崩れた場合の保険として、「メンバーシップに含まれる law_id は招待側から除外」というロジックを `membershipKeys` Set で実装。`totalCount` は単純合算（仕様どおり）、ダイジェスト表示のみ重複排除する。

7. **法律ダイジェストの並び替え**: メンバーシップは `joined_at` 降順、招待は `invited_at` 降順、両者を `sortKey` フィールドで合算してから降順マージ、先頭 5 件を取る。ISO8601 文字列の辞書順比較で降順を担保。

8. **「招待中」行のクリック先**: `<Link href="/laws">` で `/laws` 一覧へ遷移（招待受諾 UI は `/laws` 上の `PendingInvitations` に集約済み。本ページに受諾フォームを置かない方針）。

9. **`UserSilhouette` SVG の重複**: 設計どおり `HeaderUserMenu.tsx` から SVG を複製し、`MeHeader.tsx` / `ProfileCard.tsx` / `FriendsCard.tsx` 各ファイル内にローカル関数として直書き。`app/components/UserSilhouette.tsx` へのグローバル切り出しはスコープ外として行わない。**第 3 の利用者（本対応で実際に 3 箇所に重複）が確定したため、後続タスクでの切り出しを推奨**（後述「未解決事項」）。

10. **画像コンポーネント**: 設計どおり素の `<img>` を採用（`next/image` 不使用）。`next.config` の `images` 設定変更を避けるため、本対応のスコープに収めた。ESLint の `@next/next/no-img-element` は当該 4 行のみ disable コメントで抑制。

11. **`<form>`・Server Action は一切記述していない**: マイページからの編集・追加・削除を一切行わない設計に厳密に従い、本ページのレンダリングツリー全体で `<form>` / `<input>` / `<button type="submit">` / Server Action を 0 件に抑えた（grep で確認）。

12. **配色**: `stone-50` / `stone-100` / `stone-200` / `stone-400` / `stone-500` / `stone-600` / `stone-700` / `stone-800` および `brand-700` / `brand-800`、`amber-100` / `amber-700`（法律「招待中」バッジのみ）に限定。`brand-500` は **不使用**。エラー / 危険系の `rose-*` も不使用（編集系がないため）。

13. **breakpoint**: `sm:` / `md:` / `lg:` / `xl:` を **一切使用していない**（grep で 0 件確認）。全画面サイズで同一 1 カラムレイアウト（`max-w-2xl mx-auto px-4 py-10 space-y-6`）。

14. **見出し階層**: `MeHeader` 内に `<h1>{displayName}</h1>` を 1 つ。各 `SectionCard` 内に `<h2 id={titleId}>` を 1 つ。`titleId` は安定文字列（`"me-section-profile"` / `"me-section-friends"` / `"me-section-cases"` / `"me-section-laws"`）を `page.tsx` から渡し、`<section aria-labelledby>` と紐付け。`useId()` は使わない（Server Component のため）。

15. **`HeaderUserMenu` への追加**: 認証時メニュー先頭に「マイページ」`<Link href="/me">` を 1 ブロック追加するのみ。既存の `menuItemClass` 定数を再利用し、新規スタイル定義は追加していない。未認証時メニュー（ログイン / サインアップ）には変更なし。

---

## テスタ・オーディへの注意点

### 前提条件

- **DB / migration の適用は不要**。本 PR は **アプリケーションコードのみ**。`supabase/` 配下・RLS・スキーマには一切手を加えていない。
- 既存 RLS で十分通る前提（`profiles` 自分自身行 SELECT、`friend_requests_select_own`、`cases` の公開 SELECT、`laws_select_member_or_invitee`、`law_members` / `law_invitations` / `law_proposals` の既存 SELECT）。新規ポリシー・列追加なし。
- `app/actions/auth.ts` の `logout`、`middleware.ts` の認証チェック構造は不変。`PROTECTED_PATH_PREFIXES` に `/me` を 1 件追加しただけ。

### 重点確認シナリオ（arch-to-eng.md リグレッション確認シナリオ準拠）

#### マイページ本体（`/me`）

| シナリオ | 期待される挙動 |
|---|---|
| 認証時 `/me` 直接アクセス | アイデンティティ行 + 4 カード（プロフィール / フレンド / 過去のケース / 参加中の法律）が縦並びで表示 |
| 未認証時 `/me` 直接アクセス | `/auth/login` にリダイレクト（middleware が先行。page.tsx 内の二重防御 `redirect()` でも担保） |
| 未認証時 `/me/foo` 直接アクセス | 同じく `/auth/login` にリダイレクト（`pathname.startsWith("/me/")` で保護） |
| アバター未設定ユーザー | アイデンティティ行とプロフィールカードの両方で人型シルエット（`bg-stone-200` + `text-stone-600`）表示 |
| `defense_custom_instruction` 未設定 | プロフィールカードに「弁護人カスタム指示は未設定です」+ 補助文表示 |
| `defense_custom_instruction` 100 文字超 | 先頭 100 文字 + 末尾 `…`（trim 後で判定） |
| フレンド 0 人 | フレンドカードに件数バッジ「0件」+ 空状態文「まだフレンドはいません」+ 補助文 |
| フレンド 6 人以上 | 件数バッジに合計件数、ダイジェストは直近 5 件で打ち切り |
| 判決済みケース 0 件 | 過去のケースカードに件数バッジ「0件」+ 空状態文 |
| 参加中の法律 0 件 | 参加中の法律カードに件数バッジ「0件」+ 空状態文 |
| 法律の役割（オーナー） | 「オーナー」バッジ（`bg-stone-100 text-stone-700`） + `/laws/[id]` リンク |
| 法律の役割（メンバー） | 「メンバー」バッジ（`bg-stone-100 text-stone-600`） + `/laws/[id]` リンク |
| 法律の役割（招待中） | 「招待中」バッジ（`bg-amber-100 text-amber-700`） + `/laws` リンク（招待 ID は URL に含めない） |
| 各カードの「もっと見る」 | プロフィール: `/profile` / フレンド: `/friends` / 過去のケース: `/history` / 参加中の法律: `/laws` |
| 過去のケース行クリック | `/case/[id]` に遷移 |
| 法律メンバー / オーナー行クリック | `/laws/[id]` に遷移 |
| 法律「招待中」行クリック | `/laws` に遷移（招待受諾は `/laws` の `PendingInvitations` セクションで実施） |

#### 全画面サイズ（breakpoint なし確認）

| 横幅 | 期待される挙動 |
|---|---|
| 375px（スマホ） | 1 カラム、横スクロールなし、各カードが画面幅に収まる |
| 768px（タブレット） | 同上、`max-w-2xl` で中央寄せ |
| 1280px 以上（PC） | 同上、`max-w-2xl mx-auto` で中央に収まる |
| 全画面サイズ | 同一の縦並び 1 カラムレイアウト |

#### ヘッダードロップダウン

| シナリオ | 期待される挙動 |
|---|---|
| 認証時 アバタークリック | ドロップダウン展開、**先頭に「マイページ」が表示** |
| 「マイページ」クリック | `/me` に遷移 |
| 既存項目（過去のケース / フレンド / プロフィール / 区切り線 / ログアウト） | 順序・配色・遷移先・スタイル不変 |
| 未認証時メニュー（ログイン / サインアップ） | 構造・項目・スタイル不変 |
| Escape / 外側クリック / 項目クリック | 既存どおり閉じる |

#### 既存ページの非リグレッション

| ページ | 期待される挙動 |
|---|---|
| `/profile` | レイアウト・編集機能（表示名 / API キー / アバター / 弁護人カスタム指示）不変 |
| `/friends` | レイアウト・検索 / 申請 / 承認 / 削除機能不変 |
| `/history` | レイアウト・ケース一覧表示不変 |
| `/laws` | レイアウト・法律一覧 / 招待表示 / 「法律を作る」ボタン不変 |
| `/laws/[id]` | 詳細 / 改定 / 退会 / オーナー移譲 / 招待受諾不変 |
| `/auth/login` / `/auth/signup` | 遷移挙動不変 |
| ログアウト | Server Action 不変、`redirect('/')` も不変 |

#### アクセシビリティ

| シナリオ | 期待される挙動 |
|---|---|
| Tab 順序 | ヘッダー「マイページ」リンク → MeHeader プロフィール編集リンク → 各カードの「もっと見る」リンク → 各セクション内リンク |
| フォーカスリング | `focus-visible:ring-brand-700`、`brand-500` 不使用 |
| 見出し階層 | `<h1>` 1 つ（MeHeader 内・表示名）+ `<h2>` 4 つ（各カード） |
| `<section aria-labelledby>` | 各カードが `<h2 id="me-section-*">` と紐付き、SR で「プロフィール」「フレンド」「過去のケース」「参加中の法律」が読み上げられる |
| 件数バッジ | 可視テキスト `{n}件` を内包し SR が自然に読み上げる |
| 役割バッジ | 可視テキスト「オーナー」「メンバー」「招待中」を必須とし、色だけに意味が偏らない |

#### セキュリティ

| シナリオ | 期待される挙動 |
|---|---|
| `/me` HTML レスポンス | `api_key_encrypted` 文字列が含まれていない（取得列を `display_name, avatar_url, defense_custom_instruction` の 3 列に限定） |
| フレンド profile（admin 経由） | `display_name` / `avatar_url` の 2 列のみ取得。`api_key_encrypted` / `defense_custom_instruction` は含まない |
| 他人の機微情報露出 | フレンド以外の他人 profile を読み取る経路がない |
| `friendIds` 空配列 | admin クエリが発火しない（`recentIds.length > 0` ガード） |

### 確認時の留意事項

- **空状態と取得失敗の見分け**: 件数バッジが「0件」表示の場合 = 正常に取得して 0 件。バッジ非表示の場合 = 取得失敗（`null`）。取得失敗時はサーバログに `[me] <section> query failed:` が残る。
- **法律ダイジェストの並び順**: メンバーシップ（`joined_at`）と pending 招待（`invited_at`）を合算して降順マージ。同じタイムスタンプの場合は `Array.prototype.sort` の安定性に依存。
- **法律ダイジェストの重複排除**: メンバーシップに含まれる `law_id` は招待側から除外（データ整合性保険）。`totalCount` は単純合算（仕様どおり）。
- **画像読み込み失敗時の `onError` フォールバック未実装**: 設計どおり初版未対応。`profiles.avatar_url` 失効時はブラウザ既定の壊れ画像表示。実機で頻発するようなら別 backlog 化。
- **件数の精度上限**: PostgREST デフォルトの 1000 行で頭打ち。本フェーズでは想定外。個人がフレンド数千・ケース数千を持つ段階で別タスクで `count: "exact", head: true` 分離へ移行。
- **型・lint**: `npx tsc --noEmit`（エラーゼロ）および `npx eslint app/me app/components/HeaderUserMenu.tsx middleware.ts`（エラーゼロ）を確認済み。リポジトリ全体の `npm run lint` には既存の無関係なエラー（`app/case/[id]/page.tsx` の `react-hooks/set-state-in-effect`、`tests/e2e/*.spec.ts` の `@typescript-eslint/no-explicit-any`）が残存しているが、いずれも本 PR で導入したものではない（前 PR の eng-to-aud.md でも既知として記載済み）。

---

## 未実装・スコープ外にしたこと

| 項目 | 理由 |
|---|---|
| 公開プロフィールページ化（`/u/[id]` 等で他ユーザー閲覧） | スコープ外（task.md / 設計書） |
| 通知 / アクティビティフィード / 推薦ロジック等の SNS 拡張 | スコープ外 |
| 弁護人 AI 統計・利用履歴・トークン消費可視化等のセクション追加 | スコープ外（マイページに「参加中の法律」以外のセクションを追加しない） |
| `/me/edit` 等のサブパス | 編集系は既存ページに委譲（`<form>` を 1 つも置かない） |
| マイページから直接「法律の招待を受諾」する UI | 受諾は `/laws` の `PendingInvitations` に集約済み |
| アバター画像 `onError` フォールバック | 設計どおり初版未実装。FEAT-RESP-HEADER と同方針 |
| `next/image` 採用および `next.config` の `images` 設定変更 | スコープ外。素の `<img>` で対応 |
| RLS / migration / DB スキーマ変更 | task.md / 設計書の絶対条件で禁止 |
| 新規 npm 依存追加 | task.md の絶対条件で禁止 |
| breakpoint（`sm:` / `md:` / `lg:` / `xl:`）導入 | task.md の絶対条件で禁止 |
| `profiles` テーブルの RLS / 列 GRANT 整備 | MEDIUM-001 carve-out のとおり別 backlog 項目 |
| 「最近 N 件」の N をユーザー設定で可変にする機能 | スコープ外 |
| 矢印キーによるカード / 項目間ナビゲーション | 必須は Tab + Enter のみ（FEAT-RESP-HEADER と同方針） |
| `UserSilhouette` SVG のグローバル切り出し（`app/components/UserSilhouette.tsx`） | 設計どおり本タスクでは行わない。**本 PR で利用箇所が `HeaderUserMenu` / `MeHeader` / `ProfileCard` / `FriendsCard` の 4 箇所に拡大したため、後続タスクでの切り出しを推奨**（リードへ別タスク化を提案推奨） |

---

## 未解決事項 / リードへの提案

- **`UserSilhouette` SVG のグローバル切り出し**: 本 PR の実装で SVG 直書きが `HeaderUserMenu.tsx` / `MeHeader.tsx` / `ProfileCard.tsx` / `FriendsCard.tsx` の 4 箇所に拡大した（設計どおり許容）。第 3 の利用者を超えたため、`app/components/UserSilhouette.tsx` への切り出しを別タスクで提案推奨。
- **件数の精度上限**: PostgREST の 1000 行上限を超えるユーザーは件数が頭打ち。フレンド・ケース・法律のいずれかが個人で数千件規模になり始めたら `count: "exact", head: true` 分離 + ページング導入を別タスク化。
- **アバター画像 `onError` フォールバック**: 設計どおり初版未対応。`/me` 上で 4 箇所（MeHeader + 各カード）にアバターが表示されるため、Supabase Storage URL 失効時の壊れ画像表示が目立つ可能性がある。実機で頻発するようなら別 backlog 化。
