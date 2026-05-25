# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

バックログの LOW 6件を一括修正する。
新機能追加・DBスキーマ変更なし。既存コードの修正のみ。

## 背景・目的

オーディ監査で蓄積された LOW 指摘をすべて解消し、バックログをゼロにする。

## 修正対象

### E-1. `generateDraft` 内の `defenseHistory` に `truncate` 未適用

- **ファイル**: `lib/defense.ts`
- **内容**: `generateDraft` 内の `defenseHistory` ループで `escapeXml(m.content)` に `truncate` が未適用。
- **修正**: `escapeXml(truncate(m.content, 500))` に変更する。`truncate` は `@/lib/text-utils` から import 済みのものを使う。

### E-2. PATCH ハンドラ非 asGuest パスで `createSessionClient()` が try-catch 外

- **ファイル**: `app/api/cases/[id]/route.ts`
- **内容**: PATCH ハンドラの非 asGuest パス（L72 付近）で `createSessionClient()` が try-catch の外にある。
- **修正**: 当該ブロックを try-catch で囲み、例外時に `{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 }` を返す。`defense/route.ts` の try-catch パターンを踏襲すること。

### E-3. `layout.tsx` の `<main>` が子ページと二重になりうる

- **ファイル**: `app/layout.tsx`
- **内容**: layout が `<main>` でラップしているため、子ページが `<main>` を持つと HTML 仕様違反になる。
- **修正**: layout のラッパータグを `<main>` から `<div>` に変更する。

### E-4. `validateApiKey` がエラー種別を区別しない

- **ファイル**: `lib/claude.ts`
- **内容**: `catch {}` ですべての例外を握りつぶして `false` を返すため、Anthropic 障害時に正常なキーでも「無効」と表示される。
- **修正**: Anthropic SDK の `AuthenticationError`（401/403）のみキャッチして `false` を返し、それ以外の例外は再 throw する。
  ```typescript
  import Anthropic from "@anthropic-ai/sdk";
  // catch ブロック内:
  if (error instanceof Anthropic.AuthenticationError) return false;
  throw error;
  ```

### E-5. Supabase エラーが無言で握りつぶされる

- **ファイル**: `app/history/page.tsx`
- **内容①（L40）**: `if (error) throw error;` でエラー詳細が露出しないが、可観測性がゼロ。
- **内容②（L55-63）**: プロフィール取得クエリのエラーが無言で空配列になる。
- **修正①**: `console.error("[history] cases query failed:", error); throw new Error("ケース一覧の取得に失敗しました");` に変更する。
- **修正②**: `const { data: profiles, error: profilesError } = ...` としてエラーを受け取り、`if (profilesError) console.error("[history] profiles query failed:", profilesError);` を追加する。

### E-6. middleware の保護パス判定が完全一致のみ

- **ファイル**: `middleware.ts`
- **内容**: `PROTECTED_PATHS.has(pathname)` の完全一致判定のため、将来 `/history/sub` 等のサブルートが保護されない。
- **修正**: Set による完全一致判定をプレフィックスマッチに変更する。
  ```typescript
  const PROTECTED_PATH_PREFIXES = ["/", "/history", "/profile", "/case"];
  // 判定:
  if (!user && PROTECTED_PATH_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"))) {
  ```
  ただし `/` は完全一致のみとする（`/api/...` を誤って保護しないよう注意）。

## スコープ外

- HMAC トークンの決定論化（DBスキーマ変更が必要 → 別タスク）
- 新機能追加・UI 変更・DBスキーマ変更
