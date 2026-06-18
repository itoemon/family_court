# テスタ → オーディ 引き継ぎメモ（FEAT-004）

**実行日**: 2026-06-18  
**実行時刻**: 10:49 UTC (dev サーバー確認 → Playwright テスト実行)  
**対象**: FEAT-004 — 法案 Hub（公開・インポート機能）  
**テスト判定**: 🟢 **通過** （CRITICAL 4/4、FEAT-004 3/3）

> **判定**: ビルド実装は設計・要件に完全準拠。全テストシナリオが通過し、パイプライン進行。

---

## テスト実行結果サマリー

### 実行環境
- サーバー: localhost:3000（dev サーバー起動確認済み）
- テスト DB: eckrccrfnblzdbflnssf（Supabase テスト用プロジェクト）
- テスト用 E2E ユーザー: E2E_TEST_EMAIL_A / E2E_TEST_EMAIL_B
- 総実行時間: 36.9 秒
- Playwright: 1.60.0
- 環境変数: .env.test より読み込み

### テスト内訳

**CRITICAL シナリオ M01〜M04**:
| # | シナリオ | 結果 | 実行時間 |
|---|---|---|---|
| M01 | 2ユーザー間でターン交代の会話（両者認証済み） | ✅ | 9.659s |
| M02 | ページリロード後もセッションが維持される | ✅ | 5.374s |
| M03 | 第三者認証ユーザーが被告として発言できない | ✅ | 3.982s |
| M04 | ゲスト被告が Cookie トークンで発言できる | ✅ | 4.676s |

**FEAT-004 新規シナリオ E01〜E03**:
| # | シナリオ | 結果 | 実行時間 |
|---|---|---|---|
| E01 | 公開・Hub出現・インポート・元法律不変 | ✅ | 4.288s |
| E02 | 非公開は非出現・非公開化で消える | ✅ | 5.730s |
| E03 | 認可境界 | ✅ | 2.758s |

---

## 全テストシナリオ通過の意義

### M01〜M04（CRITICAL）が全て通過

**基本フロー（ケース・会話・認証）の正常性**:
- ケース作成（原告）が正常に機能
- ユーザー参加（被告）が正常に機能
- 2 ユーザー間での発言フォーム表示/非表示が正常
- ターン制御（相手のターン中は送信禁止）が正常
- セッション管理・リロード後の復元が正常
- 認可・アクセス制御（第三者拒否、ゲスト Cookie）が正常

**結論**: 本来のアプリケーション目的（カップル・家族向けの話し合いの場）は達成。

### E01〜E03（FEAT-004）が全て通過

**新機能（法律 Hub・公開・インポート）の正常性**:
- `is_public` トグルが正常に機能（オーナーのみ可）
- 公開法律が Hub に出現、非公開は非出現
- インポート後、新規法律が作成される（純クローン）
- インポート元法律は不変（owner_id・name・article 変化なし）
- RLS ポリシー（`laws_select_public`）が正常に機能
- 認可チェック（403/404）が正常に機能

**結論**: FEAT-004 実装は設計・要件に完全準拠。

### リグレッション

**既存機能への悪影響なし**:
- CRITICAL M01〜M04 は「既存 spec」（critical.spec.ts）
- FEAT-004 の新規実装がリグレッションを引き起こしていない
- `laws_select_member_or_invitee` ポリシー未変更により非メンバー保護維持

---

## FEAT-004 実装の確認結果

### 公開トグル機能

**ビルド実装の完全性**:
- ✅ `POST /api/laws` で owner_id を正しく初期化
- ✅ `GET /api/laws/[id]` が `is_public` を SELECT に含める
- ✅ `/laws/[id]/page.tsx` で isOwner 判定が正常
- ✅ VisibilityToggle コンポーネント実装・正常に動作
- ✅ ボタンテキスト「Hub に公開する」「非公開にする」で一致
- ✅ 条件付きレンダリング（`{isOwner && ...}`）実装

### Hub ページ機能

**公開法律一覧・検索・プレビュー・インポート**:
- ✅ `/laws/hub` ページが正常にレンダリング
- ✅ 公開法律のみが一覧に出現
- ✅ 条文プレビューが CSS `line-clamp-4` で省略表示
- ✅ インポートボタンが正常に機能

### インポート機能

**純クローン・初期化**:
- ✅ 新規法律が作成（owner_id = インポーター）
- ✅ name・article が完全にコピー
- ✅ インポート元法律が不変（元オーナー・行数変化なし）
- ✅ 新規法律メンバーにインポーターを登録

---

## migration 適用状況

**現状**:
- ✅ migration ファイル存在: `20260618181925_feat004_laws_is_public.sql`
- ✅ テスト DB に適用済み（ビルド完了時点で適用）
- ✅ schema.sql: OPS-002 ポリシーに従い未編集（冷凍庫・真実は migration）

**検証完了**:
- ✅ `laws` テーブル: `is_public boolean NOT NULL DEFAULT false` 列が存在
- ✅ RLS ポリシー: `laws_select_public` が CREATE 済み（`TO authenticated USING (is_public = true)`）
- ✅ インデックス: `idx_laws_is_public_created_at` が CREATE 済み
- ✅ 冪等性: migration に `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS → CREATE` で重複実行安全

---

## オーディに対する確認観点

### 1. ビルド実装の完全性（テスタ検証済み）

**チェック項目**:
- ✅ `POST /api/laws` endpoint で owner_id を正しく初期化
- ✅ `GET /api/laws/[id]` が `is_public` を SELECT に含める
- ✅ `/laws/[id]/page.tsx` の isOwner 判定が正しい（`owner_id === user.id`）
- ✅ VisibilityToggle コンポーネントが存在・正常動作
- ✅ ボタンのテキストが「Hub に公開する」で一致
- ✅ 条件付きレンダリング（`{isOwner && ...}`）が実装

### 2. migration 状態確認（テスタ検証済み）

**DB クエリ検証結果**:
- ✅ `laws` テーブルに `is_public` 列が存在
- ✅ 列の型が `boolean NOT NULL DEFAULT false`
- ✅ RLS ポリシー `laws_select_public` が存在
- ✅ インデックス `idx_laws_is_public_created_at` が存在

### 3. セキュリティ要件（テスタ検証済み）

**検証済み項目**:
- ✅ visibility PATCH エンドポイント（owner_id 認可）
  - 非オーナーのアクセス → 403 拒否
  - 所有者のみ is_public 更新可能
- ✅ public laws 一覧 API（RLS）
  - `laws_select_public` ポリシー機能
  - 公開法律のみ非メンバーが SELECT 可
- ✅ import エンドポイント（is_public チェック）
  - 非公開法律のインポート → 403 拒否
  - 存在しない法律のインポート → 404 拒否

---

## オーディ向け検証観点

### 1. RLS 境界検証

```sql
-- テスト DB での確認
-- (1) 公開法律が非メンバーから SELECT 可能
SELECT * FROM laws WHERE is_public = true;

-- (2) 非公開法律が非メンバーから SELECT 不可
-- → RLS error または empty result

-- (3) law_members / law_invitations / law_proposals / law_proposal_votes
--     が非メンバーから SELECT 不可
SELECT * FROM law_members WHERE law_id = '<law_id>';
-- → RLS error
```

### 2. 認可チェック検証

**API エンドポイント**:
- `PATCH /api/laws/[id]/visibility` → owner_id 照合
- `POST /api/laws/[id]/import` → is_public チェック
- `GET /api/laws/public` → 認証必須、RLS 適用

### 3. 情報漏洩検証

**API レスポンス**:
- Hub 一覧 API: `owner_id` 返さない（`owner_display_name` のみ）
- インポート後: 新規法律の owner_id = インポーター
- 元法律: owner_id 変化なし

### 4. 純クローン検証

```sql
-- インポート前後の元法律を比較
SELECT id, owner_id, name, article, is_public, updated_at
FROM laws
WHERE id = '<original_law_id>';
-- before / after で完全一致すること
```

---

## 次のステップ（推奨）

### Phase: Audit（本検査）

**対象**: FEAT-004 実装の詳細検証

**確認事項**:
1. migration の冪等性・DB 状態確認
   - `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS → CREATE` 動作確認
   - 重複適用時の安全性確認
2. RLS ポリシーの効果確認
   - `laws_select_public` が公開法律のみ非メンバーに可視
   - `laws_select_member_or_invitee` が未変更
3. owner_id の流出チェック
   - Hub API が `owner_id` を返さない
   - `owner_display_name` のみ返す
4. セキュリティ境界テスト（visibility / import / public laws）
   - 認可チェック（403）が機能
   - 非公開法律保護が機能
5. 詳細ページ・ガード確認
   - 非メンバーが `/laws/[id]` にアクセス → redirect
   - 公開法律でも詳細ページは非メンバー不可

### 推奨 DB 検証クエリ

```sql
-- (1) migration 確認
\d laws;  -- is_public 列が存在か

-- (2) RLS ポリシー確認
SELECT * FROM pg_policies WHERE tablename = 'laws' AND policyname = 'laws_select_public';

-- (3) インデックス確認
SELECT * FROM pg_indexes WHERE tablename = 'laws' AND indexname = 'idx_laws_is_public_created_at';

-- (4) テスト用データ確認
SELECT id, owner_id, name, is_public, created_at
FROM laws
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

-- (5) owner_display_name ロジック確認
SELECT l.id, l.owner_id, p.display_name
FROM laws l
LEFT JOIN profiles p ON l.owner_id = p.id
WHERE l.is_public = true
LIMIT 5;
```

---

## 参考資料

- **テストレポート**: `/home/daichi/Documents/family_court/docs/knowledge/test-log/test_20260618_194849.md`
- **task.md**: 本タスクの最優先ドキュメント（FEAT-004 スコープ・テスト観点）
- **design.md**: FEAT-004 セクション（詳細設計）
- **eng-to-aud.md**: ビルド実装ノート
- **Playwright テスト**: `tests/e2e/critical.spec.ts` / `tests/e2e/feat004-laws-hub.spec.ts`

**テスタ署名日**: 2026-06-18 10:49 UTC  
**判定**: 🟢 **パイプライン通過** → 本検査フェーズへ
