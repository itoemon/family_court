# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計（FEAT-001〜FEAT-006、MEDIUM-001、LOW バッチ、FEAT-RESP-HEADER、BUG-002/003/007 等、過去 PR の設計）を絶対に削除・短縮しないこと。本タスクの内容は `design.md` の末尾に新規セクションとして追記済み（`## BUG-004 対応`）であり、再度追記し直す必要はない（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは **リードが先行実装を済ませた状態でテスタ・オーディに渡している**。アーキ・ビルドは省略する。テスタは E2E spec 追加と実行、オーディはリード実装の差分監査が主目的。

## 今回のタスク

ケースルームを開いて被告として参加した直後、リロードしないと「弁護人 AI」タブが表示されない症状を修正する。ゲスト経路だけでなく、アカウント参加経路でも同じバグが潜在することを調査で確認した。

**バックログ ID**: `BUG-004`（`docs/backlog.md` 参照）
**ブランチ**: `fix/bug004-defense-tab-after-join`

---

### 背景

2026-06-13 ダイチが手動確認で発見した症状。リード調査により以下が判明:

- `CaseRoom.tsx` の `useEffect` が `fetchDefenseMessages` をマウント時に 1 回だけ呼ぶ実装。
- 参加前は defense API が 401（ゲスト）/ 403（アカウント）を返し、`setShowDefenseTab(false)` に倒れる。
- 参加後 `setMyRole("defendant")` しても `fetchDefenseMessages` は再呼び出しされず、`showDefenseTab=false` のまま残る。
- リロードで CaseRoom が再マウントされて、認証状態が確立した状態で再 fetch → 200 OK で復帰、というのが症状の正体。

---

### 修正方針（実装済み）

`app/case/[id]/CaseRoom.tsx` の `handleJoinAsAccount` と `handleJoinAsGuest` の両方で、参加 PATCH 成功 → `setMyRole("defendant")` + `setCaseData(data)` の直後に `await fetchDefenseMessages()` を明示呼び出しする（PR 差分: `+13 / -3`）。

副次効果として `useEffect` の役割が「マウント時の初回 fetch」専用に純化されたため、`react-hooks/set-state-in-effect` の disable コメントが不要になり削除した（lint warning 解消）。

---

### スコープ外（本 PR で扱わない）

- **defense API の `resolveAuth` 経路自体の見直し**: 参加前の閲覧者に空配列を返す設計に変える等は、authorization の要件として現状の 401/403 が正しいので別議論。
- **useEffect の依存配列に `myRole` を追加して自動再走させる案**: 「マウント時の初回 fetch + イベント駆動の再 fetch」と分かれている方が意図が明示的なため不採用。

---

### テスト観点（テスタが書く E2E spec の方向性）

`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー A/B（`e2e_user_a@example.com` / `e2e_user_b@example.com`、いずれもパスワードは `E2eTest123!`）はテスト DB に存在。

1. **アカウント参加経路**: ユーザー A でケース作成 → 共有リンクを取得 → 別ブラウザコンテキストでユーザー B が「アカウントで参加」→ 参加直後にリロードせずに「弁護人 AI」タブ（`text=弁護人AI`）が表示されること。
2. **ゲスト参加経路**: ユーザー A でケース作成 → 共有リンクを別ブラウザコンテキストで開き「ゲストで参加」を選択し名前を入力 → 参加直後にリロードせずに「弁護人 AI」タブが表示されること。
3. **リグレッション**: 既存 CRITICAL-M04（ゲスト被告フロー全体）が引き続き通過すること。

既存 `tests/e2e/` の慣習に合わせる（`page: Page` 型化、hard assertion）。

---

### 監査観点（オーディが見るべき論点）

design.md `## BUG-004 対応 → 監査観点` セクションに記載した 3 点を中心に確認する:

1. **race condition の有無**: `setCaseData(data)` の React reconciliation と `fetchDefenseMessages` 内の `setShowDefenseTab` の順序が問題ないか。
2. **disable コメント削除の妥当性**: `react-hooks/set-state-in-effect` plugin が今後挙動を厳格化したときに再発しないか。
3. **参加前の 401/403 ログのノイズ**: 「myRole が null のときは fetchDefenseMessages を呼ばない」というガードを追加するかどうかの判断（本 PR では既存挙動維持）。

---

### 補足

- 既存実装の差分は `git diff main app/case/[id]/CaseRoom.tsx` で確認可能。
- E2E spec の追加先は `tests/e2e/auth-defense-tab.spec.ts`（新規）または既存 `caseroom.spec.ts` 等への追加。命名は既存 spec の慣習に合わせる。
- リード実装の妥当性検証が主目的のため、テスタが spec 実行で fail を出した場合はリードがフィードバックを受けて修正する想定。オーディの HIGH 指摘も同様。
