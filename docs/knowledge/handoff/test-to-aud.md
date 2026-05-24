# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 裁判官 AI による司会機能の実装  
**日時**: 2026-05-24 09:36 UTC  
**パイプラインステップ**: テスト完了 → オーディへ引き継ぎ

---

## テスト結果サマリー

| 結果 | 内容 |
|---|---|
| **判定** | ✅ **全件通過** |
| CRITICAL-M01（2ユーザー間の会話） | ✅ 通過 (26.9秒) |
| CRITICAL-M02（セッション復元） | ✅ 通過 (12.1秒) |
| CRITICAL-M03（第三者割り込み拒否） | ✅ 通過 (10.5秒) |
| CRITICAL-M04（ゲスト被告フロー） | ✅ 通過 (8.1秒) |

**詳細レポート**: [test-log/test_20260524_183452.md](../test-log/test_20260524_183452.md)

---

## オーディへの注意点

### 1. 裁判官メッセージ表示の確認（design.md §API仕様）

E2E テストではマルチユーザーフロー検証に注力。実装レビューで以下を確認すること：

- [ ] GET /api/cases/[id] が `judgeMessages` 配列を含むか
- [ ] `judgeMessages` の各要素が `id`, `content`, `triggerType`, `createdAt` を持つか
- [ ] `created_at` 昇順が保証されているか

### 2. 裁判官メッセージ生成トリガー

**PATCH /api/cases/[id]（被告参加）** → trigger: "opening"
- [ ] `phase: "opening"` への更新後にメッセージ生成
- [ ] `plaintiffName`, `defendantName` がプロンプトに埋め込まれているか
- [ ] 原告の `api_key_encrypted` が NULL のときはスキップされるか

**POST /api/cases/[id]/argument（発言投稿）**
- [ ] judging 移行以外 → trigger: "turn"
- [ ] judging 移行時 → trigger: "closing"
- [ ] `lastSpeakerRole` が正確な「次発言者」を示しているか

### 3. タイムライン統合表示

- [ ] `arguments` と `judgeMessages` を `createdAt` 昇順でマージしているか
- [ ] `JudgeMessageBubble` が中央配置・stone 系カラー・⚖️ アイコン付きで描画されているか

### 4. セキュリティ重点確認

- [ ] `decryptApiKey` がサーバーサイド専用で実行されているか
- [ ] 復号済みキーがレスポンスに含まれていないか
- [ ] `judge_messages` への書き込みが `service_role` のみであるか
- [ ] RLS ポリシーで SELECT は許可、INSERT は拒否されるか

### 5. DB スキーマ適用状況

**ローカル開発**: supabase/schema.sql への DDL 追記済み ✅  
**本番 Supabase**: SQL Editor での実行は未完了（運用担当が実施）

確認項目:
- [ ] `judge_messages` テーブルが存在するか
- [ ] `case_id` に FK 制約・CASCADE delete があるか
- [ ] `trigger_type` に CHECK 制約（'opening'|'turn'|'closing'）があるか

### 6. 縮退動作（API キー未登録時）

- [ ] 原告が API キー未登録の場合、`judgeMessages: []` で返されるか
- [ ] UI がエラー表示なく、タイムラインに裁判官コメントなしで描画されるか

### 7. エラーハンドリング

- [ ] Claude API エラー時、メイン処理（cases update / arguments insert）は正常に完了するか
- [ ] Supabase insert エラー時も同様か
- [ ] エラーログは `console.error` のみで、レスポンスに影響しないか

---

## テストできなかったこと・スコープ外

### テストしていない（E2E 範囲外）
- **UI ビジュアル確認**: タイムラインレイアウト・バブルスタイル（手動確認推奨）
- **Claude API 連携詳細**: プロンプト入力・生成テキストの言語品質（実装レビュー推奨）
- **パフォーマンス**: Claude API レイテンシ測定（本番環境確認推奨）
- **エラーケース**: API キー無効・Claude API レート制限（統合テスト推奨）

### 設計書スコープ外（別タスク）
- WebSocket リアルタイム配信（task.md 明記）
- 弁護人 AI（task.md 明記）
- 過去ケース参照（task.md 明記）
- Supabase 本番 DB への DDL 適用（運用担当）

---

## ビルド実装ノート（eng-to-aud.md より）

既知の実装詳細:

1. **Argument.timestamp → createdAt のリネーム**
   - タイムライン sort のため実施
   - 既存コード衝突なし

2. **judge_messages テーブル DDL**
   - supabase/schema.sql に追記済み
   - ローカル開発環境では反映済み

3. **生成ブロックの try-catch 配置**
   - メイン処理の **外側** で try-catch
   - 失敗時もメイン処理は完了

4. **Haiku モデル使用**
   - `claude-haiku-4-5-20251001` で 1〜3 文の出力
   - max_tokens: 256
   - レイテンシ: +1〜2 秒

---

**参照**: [test-log/test_20260524_183452.md](../test-log/test_20260524_183452.md), [design.md](../design.md), [eng-to-aud.md](eng-to-aud.md)
