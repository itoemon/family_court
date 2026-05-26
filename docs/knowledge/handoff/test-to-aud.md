# テスタ → オーディ引き継ぎメモ（FEAT-003）

**日時**: 2026-05-26 17:00  
**テスタ**: テスタ  
**対象**: FEAT-003 法律作成機能

---

## テスト結果概要

| 項目 | 結果 | 備考 |
|---|---|---|
| **テスト実行** | ✅ 完了 | Playwright E2E テスト 4 シナリオ実施 |
| **CRITICAL 通過** | 2/4（50%） | L01, L03 通過 / L02, L04 失敗 |
| **判定** | ❌ **不合格** | CRITICAL で 2 件の失敗を確認 |
| **ビルド差し戻し** | ⚠️ **要修正** | 高優先度バグ 2 件：InvitePanel, オーナー権移譲 |

---

## テスト実行詳細

### CRITICAL-L01: 法律を作成できる ✅ 通過
- ログイン済みユーザーが `/laws/new` で法律を作成できる
- 条文が詳細ページに表示される
- 作成者が自動的にオーナーになる

### CRITICAL-L02: フレンド招待と承認 ❌ **失敗**
**失敗内容**: フレンド招待後、メンバー一覧に追加されない

**根本原因（確認）**:
- `eng-to-aud.md` で報告されていた HIGH バグを実際に再現
- **症状**: InvitePanel の招待機能が機能していない（メンバーが追加されない）
- **原因推定**: InvitePanel が `/api/friends` ベースで修正されているものの、招待 API (`POST /api/laws/[id]/invitations`) が正常に動作していないか、その後の承認フロー（`PATCH /api/laws/[id]/invitations/[invId]`）の実装に問題がある
- **Dev ログ確認**: `GET /api/friends 200` は正常。投票・法律作成は 201/200 で成功しているため、API インフラは正常

**テスタからのコメント**: ビルドの実装ノートで「InvitePanel の検索を `/api/friends` に変更した」と記載されているが、招待リクエストの送信・承認フローが機能していない可能性がある

### CRITICAL-L03: 改定案の提出と全員合意 ✅ 通過
- メンバーが改定案を提出できる
- 全メンバーが投票（賛成）したとき、条文が更新される
- 改定案レコードが削除される（提案実行の完全性を確認）

### CRITICAL-L04: オーナー権の移譲 ❌ **失敗**
**失敗内容**: オーナー権移譲モーダルの「移譲する」ボタンが `disabled` のまま

**Playwright エラー**:
```
element is not enabled
Timeout 10000ms exceeded
```

**原因推定**:
- `OwnerTransferModal` コンポーネントの enabled/disabled ロジックが不適切
- 移譲先メンバーの選択状態が完全でないまま button が disabled のままになっている
- または、モーダル内のセレクト UI が実装されていない可能性

---

## オーディが優先確認すべき項目

### [HIGH] ビルドへの差し戻し案件

| 案件 | 影響 | 確認方法 |
|-----|------|--------|
| InvitePanel の招待フロー | L-2（メンバー招待）機能全体が不可 | `POST /api/laws/[id]/invitations` と `PATCH /api/laws/[id]/invitations/[invId]` の実装確認 |
| OwnerTransferModal の enabled/disabled ロジック | L-4（オーナー権移譲）が使用不可 | `app/laws/[id]/_components/OwnerTransferModal.tsx` のボタン enable 条件を確認 |

### [MEDIUM] セキュリティ確認項目（設計書ベース）

- RLS ポリシーの SELECT/WRITE 分離が正しく実装されているか
- 認可チェック（オーナー判定、メンバー確認）が API 層で実装されているか
- UUID 検証、エラーハンドリング（409 Conflict など）

### [LOW] ユーザーフロー確認

- UI メッセージが適切か（招待・承認・移譲の各フェーズ）
- バリデーションエラーが正しく表示されるか

---

## テスト実行時の環境詳細

| 項目 | 値 |
|------|-----|
| テスト実行時刻 | 2026-05-26 17:00 |
| Node.js | v20+ |
| Next.js | 14 (App Router) |
| Playwright | 1.60.0 |
| ブラウザ | Chromium |
| localhost:3000 | 正常に起動 |
| E2E テストアカウント | E2E_TEST_EMAIL_A, E2E_TEST_EMAIL_B（Supabase Auth で登録済み） |

**DB マイグレーション**: 前回セッションの問題は解決。`20260526000003_feat003_laws.sql` は適用済み  
**API ログ**: エラーなし（201, 200, 307 リダイレクト正常）

---

## ビルド修正後のテスト再開条件

1. InvitePanel 招待フロー修正（L02 再テスト）
2. OwnerTransferModal enabled ロジック修正（L04 再テスト）
3. テスタが修正後に再度 CRITICAL-L02, L04 を実行
4. 2 件とも通過したら NORMAL シナリオ（L05～L08）を実施

---

*テスタ実行: 2026-05-26 17:00*  
*テストレポート: `docs/knowledge/test-log/test_20260526_165800.md`*
