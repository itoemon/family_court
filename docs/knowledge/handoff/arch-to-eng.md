# アーキ → ビルド 引き継ぎメモ

**タスク**: 裁判官 AI による司会機能の実装  
**設計書**: `docs/knowledge/design.md`

---

## 実装の順序と依存関係

| 順番 | ファイル | 内容 | 依存 |
|------|----------|------|------|
| 1 | `supabase/schema.sql` | `judge_messages` テーブルを追加（DDL は設計書§データモデル参照） | なし |
| 2 | Supabase ダッシュボード | DDL を SQL Editor で実行して本番 DB に適用 | 順番 1 |
| 3 | `lib/types.ts` | `JudgeTrigger`・`JudgeMessage` 型の追加、`Case` への `judgeMessages` 追加 | なし |
| 4 | `lib/judge.ts` | 新設。`generateJudgeMessage` 実装 | 順番 3 |
| 5 | `lib/case-response.ts` | `judge_messages` クエリ追加・戻り値に `judgeMessages` 追加 | 順番 3 |
| 6 | `app/api/cases/[id]/route.ts` | PATCH ハンドラに開廷宣言生成を追加 | 順番 4・5 |
| 7 | `app/api/cases/[id]/argument/route.ts` | POST ハンドラにターン進行・閉廷コメント生成を追加 | 順番 4・5 |
| 8 | `app/components/JudgeMessageBubble.tsx` | 新設。表示コンポーネント | 順番 3 |
| 9 | `app/case/[id]/page.tsx` | タイムライン統合表示 | 順番 8 |

---

## 設計上の判断

### 別テーブル `judge_messages` を採用した理由

`arguments.role` に `'judge'` を追加する案は却下した。

却下理由:
- `arguments` テーブルの `role` CHECK 制約（`'plaintiff'|'defendant'`）を変更すると、ターン判定・権限確認の既存ロジックに影響が広がる
- `round` カラムが裁判官メッセージに無意味（NOT NULL 制約のためダミー値か制約変更が必要になる）
- `trigger_type`（opening/turn/closing）という裁判官固有のカラムを持たせる先として `judge_messages` が自然

別テーブルの欠点（タイムライン統合のためクライアント側マージが必要）は `created_at` ソートで解決できるため許容範囲内。

### `lib/judge.ts` を `lib/claude.ts` と分離した理由

`lib/claude.ts` は「APIキーを受け取りClaudeを呼ぶ低レベルラッパー」として責務が明確。裁判官固有のプロンプト構築ロジックを同ファイルに混入させると保守性が下がる。新機能追加で既存の `validateApiKey`・`requestVerdict` の責務が変わらないよう分離した。

### 裁判官コメント生成のモデルに Haiku を選んだ理由

`claude-haiku-4-5-20251001` を使用する。判決生成（`claude-sonnet-4-6`）と異なりコメントは 1〜3 文の短い出力であり、Haiku で品質上十分。BYOK のため原告の API コストを無闇に増やさないことを優先した。

### 同期実行（`await`）を採用した理由

非同期（fire-and-forget）にするとポーリングとの競合が発生しうる（POST レスポンスが返った直後に GET が来たとき judge message がまだ DB にない）。ポーリング方式では `await` で同期実行した方が整合性を保ちやすい。Claude API のレイテンシ増加は許容する（Haiku 使用で最小化）。

---

## 注意事項・落とし穴

### APIキー未登録時の縮退

`profiles.api_key_encrypted` が null の場合は `generateJudgeMessage` を呼ばず、`console.warn` のみ残す。ケース進行への影響ゼロを守ること。エラーレスポンスを返してはいけない。

### try-catch の境界

裁判官メッセージ生成ブロック（APIキー取得→復号→生成→insert）は 1 つの try-catch で囲む。catch 内では `console.error` のみ実行し、`return NextResponse.json(...)` で失敗レスポンスを返してはいけない。メイン処理（argument の insert・case の update）は catch ブロックの外で完了させること。

### 名前取得の順序（PATCH ハンドラ）

PATCH ハンドラ内でのプロンプト用名前取得:

- **原告名**: `admin.from("profiles").select("display_name").eq("id", c.plaintiff_id)` で取得（`c` は冒頭の cases クエリ結果）
- **被告名（アカウント）**: ハンドラ内の `profile?.display_name`（既存コードで既に取得済み）
- **被告名（ゲスト）**: `body.defendantName.trim()`

既存コードをよく読んでから追加位置を決めること。`buildCaseResponse` はここでも呼ばれるが、そちらからは名前を取り出さない（buildCaseResponse のシグネチャを変えない）。

### `buildCaseResponse` 戻り値の型

`buildCaseResponse` の戻り値は現状型推論（`null` or オブジェクトリテラル）で、明示的な型が付いていない。`judgeMessages` を追加しても同様に型推論で問題ない。ただし `JudgeTrigger` への as キャストを忘れると TypeScript エラーになる（設計書コード例参照）。

### AGENTS.md の警告

AGENTS.md に「このバージョンには破壊的変更がある」とある。Next.js のバージョンは 16.2.6 で、`params` が `Promise<{ id: string }>` になっている（既存コードで確認済み）。新しいルートハンドラを書く場合は既存コードのパターンを踏襲すること。`cookies()` の非同期化についても既存コードの `req.cookies.get(...)` パターンを参考にすること。

### `supabase/schema.sql` への追記位置

`judge_messages` の DDL は `verdicts` テーブル定義の後ろに追記する。コメント行（`-- judge_messages: 裁判官 AI によるコメント`）を付けてテーブル間の区切りを明確にすること。Supabase SQL Editor での実行も忘れずに行うこと（スキーマファイルを更新しただけでは本番に反映されない）。

---

## スコープ外（バックログに残す）

以下は本タスクに含めないこと。

| バックログ | 内容 |
|-----------|------|
| WebSocket/リアルタイム配信 | ポーリングで十分（task.md 明記） |
| 弁護人 AI | 別タスク（task.md 明記） |
| 過去ケース参照 | 別タスク（task.md 明記） |
| MEDIUM-001（UUID公開） | 既存バックログ |
| MEDIUM-002（HMAC決定論的） | 既存バックログ |
| LOW-001（ゲスト名最大長）他 | 既存バックログ |
