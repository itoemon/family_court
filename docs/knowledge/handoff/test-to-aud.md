# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: F-1 HMAC ゲストトークンを nonce ベース刷新（MEDIUM 1件）
**テスト日時**: 2026-05-25 18:52:43
**テスト判定**: ✅ **通過（全 CRITICAL シナリオ合格）**
**テストレポート**: [test-log/test_20260525_185243.md](../test-log/test_20260525_185243.md)

---

## テスト結果サマリー

| シナリオ | 状態 | 詳細 |
|---|---|---|
| CRITICAL-M01 | ✅ 通過 | 認証済み被告の会話フロー正常（12.9秒） |
| CRITICAL-M02 | ✅ 通過 | セッション復元正常（8.1秒） |
| CRITICAL-M03 | ✅ 通過 | 第三者割り込み拒否正常（7.7秒） |
| CRITICAL-M04 | ✅ 通過 | ゲスト被告フロー正常（7.2秒） |

**総合**: 4/4 通過 → **パイプライン進行可能**

---

## 実装状況の検証（テスタ監査）

### 通過確認事項

1. **DB スキーマ・RLS**
   - ✅ `guest_tokens` テーブルが正常に CREATE・初期化
   - ✅ Service Role のみアクセス可（RLS ポリシー有効）
   - ✅ expires_at・revoked_at による期限・取り消し管理が動作

2. **トークン発行フロー（generateGuestToken）**
   - ✅ 32 バイト nonce を cryptographically secure に生成
   - ✅ HMAC-SHA256(nonce, GUEST_TOKEN_SECRET) でハッシュを計算
   - ✅ nonce のみ Cookie に返却（token_hash は DB 保存）
   - ✅ Admin Client を使用した INSERT が正常実行
   - ✅ 7日有効期限が正しく計算される

3. **トークン検証フロー（verifyGuestToken）**
   - ✅ Cookie の nonce を受け取り HMAC を再計算
   - ✅ guest_tokens テーブルで token_hash・expires_at・revoked_at をすべて検証
   - ✅ 無効なトークンで `false` を正しく返却

4. **セッション管理**
   - ✅ ページリロード後も Cookie トークンが維持
   - ✅ 同一ゲストは複数回発言可能
   - ✅ 異なるゲストは独立したトークンで隔離

5. **セキュリティ境界**
   - ✅ 第三者（plaintiff でも defendant_id でもないユーザー）は発言フォーム非表示
   - ✅ observer ロール判定が正常に機能
   - ✅ ゲストトークンの暗号化フロー全体が fail-closed（デフォルト拒否）

### 非同期化確認

| ファイル | 関数 | 状態 |
|---|---|---|
| `lib/guest-token.ts` | `generateGuestToken()` | ✅ async → Promise<string> |
| `lib/guest-token.ts` | `verifyGuestToken()` | ✅ async → Promise<boolean> |
| `app/api/cases/[id]/route.ts` | PATCH（asGuest） | ✅ await 適用 |
| `app/api/cases/[id]/argument/route.ts` | POST | ✅ await 適用 |
| `app/api/cases/[id]/defense/route.ts` | POST | ✅ await 適用 |
| `app/api/cases/[id]/defense/draft/route.ts` | POST | ✅ await 適用 |

---

## オーディへの引き継ぎ

全 CRITICAL シナリオが通過したため、パイプラインはオーディフェーズに進行。
オーディが以下を最終監査すること：

1. **マイグレーション適用確認**
   - `supabase/migrations/20260525000003_add_guest_tokens.sql` が適用済み
   - RLS が機能している（anon・authenticated からは SELECT 不可）

2. **暗号化・プライバシー**
   - nonce・token_hash の分離が機構通り
   - Cookie キャプチャ後の延命攻撃が不可（token_hash なしでは検証失敗）
   - 個別取り消し（revoked_at）が可能（将来の拡張に対応）

3. **監査ログ・トレーサビリティ**
   - ゲストトークン発行・検証のログ出力が適切か

4. **スコープ外の境界確認**
   - 手動取り消し UI は未実装（スコープ外として OK）
   - トークン一覧管理画面は未実装（スコープ外として OK）

---

**参照**: [test-log/test_20260525_185243.md](../test-log/test_20260525_185243.md), [task.md](../task.md), [design.md](../design.md), [eng-to-aud.md](eng-to-aud.md)
