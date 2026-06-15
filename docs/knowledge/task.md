# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計を絶対に削除・短縮しないこと（[[feedback-design-md]] 参照）。本タスクは UI 構造のみの予防的修正で、設計書への追記対象は無い。design.md の修正は **しない**。
>
> **重要 2**: 本タスクは **リードが先行実装を済ませた状態でテスタ・オーディに渡している**。アーキ・ビルドは省略する（PR #47 と同じパターン）。テスタはリグレッション確認が主目的、オーディはリード実装の差分監査が主目的。

## 今回のタスク

`useSearchParams()` を使う Client Component に `<Suspense>` 境界を付与する。Next.js 16 App Router の公式ガイダンス遵守と、将来の静的最適化への備え。

**バックログ ID**: BUG-008
**ブランチ**: `feature/20260615-201330-bug-008`（既に切ってある）

---

### 背景

`app/auth/login/page.tsx` と `app/case/[id]/CaseRoom.tsx` で `useSearchParams()` を直接呼び出しているが、いずれも最寄りの祖先で `<Suspense>` でラップされていない。`app/layout.tsx:44` の `<Suspense>` は `<Header />` のみを包んでおり、`{children}` 配下には Suspense 境界が存在しない。

現時点ではテスタ実行で build エラー・ランタイム警告が観測されていない。両ページとも `"use client"` 全体で初めからクライアント側レンダリングであり静的化されていないため実害なし。ただし Next.js の公式ガイダンスでは Suspense ラップが推奨されており、将来 Next.js の静的最適化が強化された際に build 警告が出る可能性がある。

backlog [BUG-008]、由来: 2026-06-15 BUG-007 監査（audit_20260615_095410.md LOW-001）。

---

### 修正方針（実装済み）

#### 1. `/auth/login` ― Server + Client 分割

- `app/auth/login/LoginForm.tsx` を新規作成し、現状の `page.tsx` の中身（`useState` / `useRouter` / `useSearchParams` / フォーム JSX）をそのまま移す。`export default function LoginForm` とする
- `app/auth/login/page.tsx` を Server Component に書き換え、`<Suspense fallback={<LoginFormSkeleton />}><LoginForm /></Suspense>` でラップ
- `LoginFormSkeleton` は同ファイル内で定義（または `LoginForm.tsx` から export）。ログインフォームの骨組み（h1「ログイン」 + 無効化された input 2 つ + 無効化されたボタン）を表示

#### 2. `/case/[id]` ― 既存 Server Component に Suspense ラップ

- `app/case/[id]/page.tsx` は既に Server Component（PR #36 で変換済み）。`<CaseRoom caseId={id} />` を `<Suspense fallback={<CaseRoomSkeleton />}><CaseRoom caseId={id} /></Suspense>` でラップ
- `CaseRoomSkeleton` は `app/case/[id]/page.tsx` 内に定義するか、別ファイルに切り出す。シンプルな「読み込み中…」テキストで OK（CaseRoom は 825 行と大きいが、Suspense fallback は loading 状態の placeholder で十分）
- `CaseRoom.tsx` 自体は触らない（825 行のロジックを変更しない）

---

### スコープ外

- `CaseRoom.tsx` の内部リファクタ（825 行の責務分割は別タスク）
- `useSearchParams()` のロジック変更（既存挙動を維持）
- `app/layout.tsx` の `<Suspense>` 境界の見直し（`Header` だけ包む構造は本タスクで触らない）
- 他の Client Component (例: `signup/page.tsx`) の Suspense 化（`useSearchParams()` を使っていない経路は対象外）

---

### テスト観点（テスタが行うリグレッション確認の方向性）

`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー A/B（`e2e_user_a@example.com` / `e2e_user_b@example.com`、パスワード `E2eTest123!`）はテスト DB に存在。

#### 必須（リグレッション確認）

1. **CRITICAL M01〜M04 をフル実行**: 既存の 2 ユーザー会話・セッション復元・第三者割り込み拒否・ゲスト被告フローが全て通過すること
2. **BUG-007 / BUG-004 関連 spec 実行**: 既存の `?next=` 解釈・ログイン後遷移・弁護人 AI タブ表示が引き続き動作すること
3. **`tests/e2e/bug005-closing-trigger.spec.ts` 実行**: BUG-005 の動作が壊れていないこと

#### 推奨

4. `npm run build` が `useSearchParams()` 関連の警告を出さないこと（実装時に既に確認済み、テスタは build を回さなくて良い）

#### 新規 spec

本タスクでは新規 E2E spec を **追加しない**。Suspense 境界の有無は静的な構造変更で、既存 CRITICAL spec が認証フロー全体を経由しているため、これらが通れば回帰検知として十分。新規 spec を増やすメリットは小さい（spec 増加によるパイプライン時間増のデメリットの方が大きい）。

---

### オーディに対する観点

- `app/auth/login/page.tsx` が Server Component（`"use client"` ディレクティブなし）になっていること
- `LoginForm.tsx` に `useSearchParams()` が残っていること、`<Suspense>` の祖先側でラップされていること
- `app/case/[id]/page.tsx` が `<Suspense>` で `<CaseRoom />` を包んでいること、CaseRoom 自身は変更されていないこと
- fallback の Skeleton コンポーネントが「読み込み中」を視覚的に示すレベルの最小実装になっていること（過度な装飾を避ける）
- `useSearchParams()` を使う他の Client Component が新たに発生していないこと（grep `-rn "useSearchParams" app/` で 2 箇所のみであることを確認）
- **git status 最終確認**: 新規ファイル `LoginForm.tsx` が untracked のまま残っていないこと（[[feedback-commit-check]]）

---

### 関連ファイル

- `app/auth/login/page.tsx` (Server Component に書き換え、Suspense ラップ追加)
- `app/auth/login/LoginForm.tsx` (新規、既存 page.tsx の中身を移植)
- `app/case/[id]/page.tsx` (Suspense ラップ追加、`CaseRoomSkeleton` 定義)
- `app/case/[id]/CaseRoom.tsx` (変更なし)
- `app/layout.tsx` (変更なし)

---

### 確定事項

- リード先行実装で進める（アーキ・ビルド省略、PR #47 前例）
- 新規 E2E spec は追加しない（既存 CRITICAL でリグレッション検知が十分）
- design.md への追記はしない（UI 構造変更のみで、永続資料に残す設計判断が無い）
- ブランチ命名は agents.sh のハードコード命名と併存しないよう、リードが事前に切る形を採用
