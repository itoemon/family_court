# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: BUG-004 — 参加直後に弁護人 AI タブが表示されない問題の修正（ゲスト経路 + アカウント経路の両方）
**日時**: 2026-06-15
**ブランチ**: fix/bug004-defense-tab-after-join
**特記**: 本タスクはリードが先行実装を済ませた状態でテスタ・オーディに渡している。アーキ・ビルドは省略。リードが実装した差分の妥当性検証と E2E spec 追加が本パイプラインの主目的。

由来: `docs/backlog.md` の BUG-004、`docs/knowledge/design.md ## BUG-004 対応`。

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/case/[id]/CaseRoom.tsx` | 変更 | (1) `handleJoinAsAccount` の参加成功後に `await fetchDefenseMessages()` を追加 (2) `handleJoinAsGuest` の参加成功後に同じく `await fetchDefenseMessages()` を追加 (3) `useEffect` 内の `eslint-disable-next-line react-hooks/set-state-in-effect` を削除（不要になったため lint warning 解消） |

差分: `+13 / -3`。

---

## 設計判断と注意事項

### 修正アプローチ

参加 PATCH 成功後にクライアント側で明示的に `fetchDefenseMessages()` を呼ぶことで、認証クッキー / guest cookie が確実に有効な状態で defense API が呼ばれる。これにより 200 OK が返り、`setShowDefenseTab(true)` で弁護人 AI タブが表示される。

### 代替案を採用しなかった理由

- **useEffect の依存配列に `myRole` を追加して自動再走**: 「state 更新を依存配列で受ける」設計に倒れ、コードの意図が曖昧になる。「マウント時の初回 fetch + 明示的なイベント駆動の再 fetch」と分かれている方が読者にとって明示的なため、明示呼び出し方式を採用。
- **defense API の resolveAuth 経路自体の見直し**: 参加前の閲覧者に空配列を返す等は authorization の要件として現状の 401/403 が正しいため、本 PR では触らない。

### lint warning 解消について

`react-hooks/set-state-in-effect` の disable コメントが不要と判定された理由: `fetchDefenseMessages` が `handleJoinAsAccount` / `handleJoinAsGuest` からも直接呼ばれるようになったことで、useEffect 内の呼び出しが「マウント時の初回 fetch」に純化された。eslint plugin はこのパターンを「副作用としては問題なし」と判定する。

---

## テスト観点（テスタへの引き継ぎ）

1. **アカウント参加直後の弁護人 AI タブ表示**: ユーザー A でケース作成 → ユーザー B が別ブラウザコンテキストで「アカウントで参加」→ リロードせずに「弁護人 AI」タブが表示されること。
2. **ゲスト参加直後の弁護人 AI タブ表示**: ユーザー A でケース作成 → ゲスト経路で参加 → リロードせずに「弁護人 AI」タブが表示されること。
3. **リグレッション**: 既存 CRITICAL-M04 が引き続き通過すること。

E2E 実行環境: `TEST_MODE=1` 経由で `.env.test` を読み、テスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー（`e2e_user_a` / `e2e_user_b`、パスワード `E2eTest123!`）は既にテスト DB に存在する。

---

## 監査観点（オーディへの引き継ぎ）

design.md `## BUG-004 対応 → 監査観点` セクションに記載した 3 点を中心に確認すること:

1. **race condition の有無**: `setCaseData(data)` の React reconciliation と `fetchDefenseMessages` 内の `setShowDefenseTab` の順序
2. **disable コメント削除の妥当性**: react-hooks plugin の挙動厳格化への耐性
3. **参加前 401/403 ログのノイズ**: ガード追加すべきかの判断
