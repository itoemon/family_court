# バックログ

オーディが監査で検出した未修正の指摘を蓄積するファイルです。
リードがセッション開始時・PR マージ後にダイチへ内容を共有します。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映してください。

---

## 未対応

### [LOW] layout.tsx の `<main>` が子ページと二重になりうる

- **ファイル**: `app/layout.tsx:33`
- **内容**: layout が `<main>` でラップしているため、子ページが `<main>` を持つと HTML 仕様違反になる
- **修正案**: layout のラッパーを `<div>` に変更するか、子ページは `<main>` を使わないと規約化する
- **由来**: audit_20260519_162635.md / LOW-002

---

## 対応済み

### [MEDIUM] logout() で signOut() のエラーが握り潰される

- **ファイル**: `app/actions/auth.ts`
- **対応コミット**: feature/fix-medium-audit-issues
- **由来**: audit_20260519_162635.md / MEDIUM-001

### [MEDIUM] Header の非同期処理に Suspense 境界がない

- **ファイル**: `app/layout.tsx`
- **対応コミット**: feature/fix-medium-audit-issues
- **由来**: audit_20260519_162635.md / MEDIUM-002
