# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: 裁判官 AI による司会機能の実装  
**日時**: 2026-05-24

---

## 実装上の判断・変更点

### 変更・追加ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/schema.sql` | 変更 | `judge_messages` テーブル DDL を追記。既存テーブルへの変更なし。 |
| `lib/types.ts` | 変更 | `JudgeTrigger`・`JudgeMessage` 型を追加、`Case` に `judgeMessages: JudgeMessage[]` を追加。`Argument.timestamp` を `createdAt` にリネーム（後述）。 |
| `lib/judge.ts` | 新設 | `generateJudgeMessage` 関数。`claude-haiku-4-5-20251001` で1〜3文の裁判官コメントを生成。 |
| `lib/case-response.ts` | 変更 | `judge_messages` クエリ追加・`judgeMessages` を戻り値に追加。`arguments` の DB カラム名マッピングも修正（後述）。 |
| `app/api/cases/[id]/route.ts` | 変更 | PATCH ハンドラのアカウント参加・ゲスト参加両パスに `opening` トリガー生成ブロックを追加。 |
| `app/api/cases/[id]/argument/route.ts` | 変更 | POST ハンドラに `turn` / `closing` トリガー生成ブロックを追加。 |
| `app/api/cases/[id]/verdict/route.ts` | 変更 | `Case` 型に `judgeMessages: []` を追加（型エラー修正のみ、ロジック変更なし）。`arguments` マッピングも修正。 |
| `app/components/JudgeMessageBubble.tsx` | 新設 | 裁判官メッセージ表示コンポーネント。中央配置・stone 系カラー・⚖️ アイコン付き。 |
| `app/case/[id]/page.tsx` | 変更 | `arguments` と `judgeMessages` を `createdAt` 昇順でマージしたタイムライン表示に変更。 |

---

### `Argument.timestamp` → `createdAt` のリネーム（設計書への逸脱）

設計書に明示はないが、タイムライン sort のために `Argument.createdAt` が必要だった。既存の `Argument.timestamp` フィールドが DB カラム名 `created_at` と不一致のまま未使用だったため、このタイミングで `createdAt` にリネームし `case-response.ts` でのマッピングを追加した。

既存コードで `timestamp` を参照している箇所はなかった（型チェック・grep で確認済み）。

---

### 裁判官コメント生成の同期実行（設計書通り）

`await` で同期実行している。`buildCaseResponse` の前に完了させることで、PATCH/POST のレスポンスに生成済みコメントが含まれる。Claude API（Haiku）のレイテンシは 1〜2 秒程度増加するが、設計書の判断通り許容している。

---

### `judge_messages` の DB 適用

`supabase/schema.sql` への DDL 追記は完了済み。**Supabase ダッシュボードの SQL Editor での実行は未完了**（ビルドのスコープ外。運用担当が本番 DB に適用すること）。

---

## オーディへの注意点

### 重点確認ポイント

1. **開廷宣言（opening）**: ゲスト参加・アカウント参加の両方で PATCH 後のレスポンスに `judgeMessages` が含まれること。原告の API キー未登録時は `judgeMessages: []` のままでケース進行に影響がないこと。

2. **ターン進行コメント（turn）**: 各発言投稿後（judging 移行以外）に `judgeMessages` が1件ずつ増えること。`callerRole`（発言したロール）が `lastSpeakerRole` として `generateJudgeMessage` に渡り、正しい「次の発言者」が示されること。

3. **閉廷コメント（closing）**: 最終発言投稿後（`nextPhase === "judging"` のとき）に `trigger_type: "closing"` のメッセージが生成されること。

4. **タイムライン表示**: `arguments` と `judgeMessages` が `createdAt` 昇順でマージされ、⚖️ バブルが適切な位置（発言の間）に挿入されること。

5. **縮退動作**: 原告の `api_key_encrypted` が null のケースでは `judgeMessages` が空配列で返り、タイムラインに裁判官コメントが表示されないこと（エラー表示なし）。

6. **セキュリティ**: 復号済み API キーがレスポンスに含まれないこと。`judge_messages` への書き込みが service_role 経由のみであること（anon/authenticated から INSERT が弾かれること）。

### try-catch の境界確認

PATCH・POST いずれも、裁判官メッセージ生成ブロック（try-catch）の外でメイン処理（cases update / arguments insert）が完了している。Claude API が例外を投げた場合、`console.error` のみ出力してレスポンスはメイン処理の結果をそのまま返す。

---

## 未実装・スコープ外

| 項目 | 内容 |
|---|---|
| **Supabase 本番 DB への DDL 適用** | `schema.sql` の DDL 追記は完了。SQL Editor での実行は運用担当が行うこと |
| WebSocket リアルタイム配信 | task.md 明記でスコープ外 |
| 弁護人 AI | task.md 明記でスコープ外・別タスク |
| 過去ケース参照 | task.md 明記でスコープ外・別タスク |
| MEDIUM-001（UUID 公開） | 既存バックログ |
| MEDIUM-002（HMAC 決定論的） | 既存バックログ |
| LOW-001 他 | 既存バックログ |
