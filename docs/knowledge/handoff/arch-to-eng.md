# アーキ → ビルド 引き継ぎメモ

**タスク**: PR #3 コパ指摘 4 件の修正
**設計書**: `docs/knowledge/design.md`

---

## 実装の順序と依存関係

| 順番 | ファイル | 内容 |
|------|----------|------|
| 1 | `lib/guest-token.ts` | 環境変数ガードを追加（Fix 3） |
| 2 | `app/api/cases/[id]/route.ts` | GET ハンドラに `callerRole` を追加（Fix 1） |
| 3 | `app/api/profile/route.ts` | PUT ハンドラのレスポンスに `hasApiKey` を追加（Fix 2） |
| 4 | `app/case/[id]/page.tsx` | `callerRole` を使った `myRole` 復元（Fix 1 クライアント側） |
| 5 | `app/profile/page.tsx` | `hasApiKey` 同期 + catch のエラーメッセージ（Fix 2・4） |

Fix 1（callerRole 算出）は `verifyGuestToken` を呼ぶため Fix 3 に依存する。Fix 3 を先に実装すること。それ以外の 4 件は互いに独立している。

---

## 設計上の判断

### Fix 1: callerRole の追加先を GET /api/cases/[id] とした理由

バックログ MEDIUM-001 は `/api/cases/[id]/my-role` という専用エンドポイントを提案している。しかし task.md は「GET /api/cases/[id] のレスポンスにサーバー側で `callerRole` を含めて返す」と明示しており、task.md が最優先のため既存エンドポイントへの追加を採用した。クライアントの余分な API コールを防げる利点もある。

### Fix 1: ロール判定のロジックを argument route と統一した

`callerRole` の決定ロジックは HIGH-001 で実装済みの `app/api/cases/[id]/argument/route.ts` と同一の方式（`getUser()` + UUID 照合、ゲストは Cookie 検証）を採用している。同一ケースで 2 つのエンドポイントが異なるロール判定をする事態を防ぐため、コードが冗長でも 2 か所に書く。将来的にロジックが複雑化した場合は共通ヘルパーへの抽出を検討すること（今回はスコープ外）。

### Fix 2: サーバーレスポンスで `hasApiKey` を同期する理由

API キーの有無はサーバー（DB）が唯一の事実源である。クライアント側で「API キーフィールドが空かどうか」を見る方法では、既存のキーを保持したまま表示名だけを更新した場合に誤った `false` になる。サーバーレスポンスを事実源とする設計を採用した。

### Fix 3: 関数内ガード（モジュールトップレベルでの throw は採用しない）

バックログの修正案ではモジュールトップレベルで throw することを提案しているが、task.md の指示（「関数内で明示的にガードし、未設定時は原因が追えるエラーを返すこと（500 + 説明文）」）を優先した。実装上の差は小さいが、task.md が最優先のルールであるため従う。

---

## 注意事項・落とし穴

### GUEST_TOKEN_SECRET エラーのクライアント隠蔽

`verifyGuestToken` / `generateGuestToken` が throw した Error の raw メッセージ（環境変数名を含む）はクライアントに渡さないこと。これらを呼び出す API Route の catch ブロックで捕捉し、`{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }` を 500 で返すこと。

### `err instanceof Error` チェック

Fix 4 の catch 節で `err.message` を参照する場合、TypeScript が `err: unknown` とした際に直接アクセスするとコンパイルエラーになる。`err instanceof Error ? err.message : "保存中にエラーが発生しました"` の形でガードすること。

### `createSessionClient` のインポート確認

GET /api/cases/[id] の route.ts に `createSessionClient` のインポートが既にあるか確認すること。存在しない場合は `@/lib/supabase/server` から追加する。

### req.cookies.get() を使う理由

GET ハンドラ内での Cookie 読み取りには `req.cookies.get(...)` を直接使うこと。`cookies()` はバージョンによって非同期（`await` 必要）になる場合がある（AGENTS.md の警告参照）。`req.cookies` はリクエストオブジェクト直属のため `await` 不要でシンプル。ただし実装前に `node_modules/next/dist/docs/` で本プロジェクトの Next.js バージョンの挙動を確認すること。

---

## スコープ外（バックログに残す）

以下は task.md のスコープ外。次のパイプラインサイクルでリードが task.md を更新してから対応すること。

| バックログ | 内容 |
|-----------|------|
| MEDIUM-001 | GET /api/cases/[id] が `plaintiff_id` / `defendant_id` UUID をクライアントに公開 |
| MEDIUM-002 | HMAC トークンが決定論的（取り消し・個別セッション無効化が不可） |
| LOW-001 (route.ts) | ゲスト名の最大長バリデーションなし |
| LOW-001 (claude.ts) | `validateApiKey` がエラー種別（無効キー / API 障害）を区別しない |
| MEDIUM (auth.ts) | ログアウト失敗時にユーザーへの通知がない |
| LOW (layout.tsx) | `<main>` タグの二重ネスト問題 |
