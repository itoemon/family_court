# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: LOW バッチ（FEAT-003 監査由来）対応 — LOW-001 / LOW-002
**日時**: 2026-05-29
**ブランチ**: feature/20260529-154844

由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md` の LOW-001 / LOW-002

---

## 変更ファイル一覧

### 共通ユーティリティ

| ファイル | 種別 | 内容 |
|---|---|---|
| `lib/text-utils.ts` | 追記 | `UUID_REGEX` と型ガード `isUuid(value): value is string` を新規 export |

### LOW-001: UUID_REGEX 重複解消（ボディ検証の挙動は不変・参照差し替えのみ）

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/api/laws/[id]/invitations/route.ts` | 変更 | ローカル `UUID_REGEX` 定義を削除し共通 import に置換。`[id]` パスガード追加 |
| `app/api/laws/[id]/owner/route.ts` | 変更 | ローカル `UUID_REGEX` 定義を削除し共通 import に置換。`[id]` パスガード追加 |
| `app/api/friends/requests/route.ts` | 変更 | ローカル `UUID_REGEX` 定義を削除し共通 import に置換（動的セグメント無し・ガード追加なし） |

### LOW-001: パスパラメータ UUID ガード追加（各メソッド先頭・DB アクセス前）

| ファイル | メソッド | ガード対象 |
|---|---|---|
| `app/api/laws/[id]/route.ts` | GET | `id` |
| `app/api/laws/[id]/invitations/route.ts` | POST | `id` |
| `app/api/laws/[id]/invitations/[invId]/route.ts` | PATCH | `id`, `invId` |
| `app/api/laws/[id]/members/me/route.ts` | DELETE | `id`（`me` はリテラル・対象外） |
| `app/api/laws/[id]/owner/route.ts` | PATCH | `id` |
| `app/api/laws/[id]/proposals/route.ts` | POST | `id` |
| `app/api/laws/[id]/proposals/[propId]/route.ts` | DELETE | `id`, `propId` |
| `app/api/laws/[id]/proposals/[propId]/votes/route.ts` | POST | `id`, `propId` |
| `app/api/cases/[id]/route.ts` | GET, PATCH | `id`（ゲスト/認証分岐より前に配置） |
| `app/api/cases/[id]/argument/route.ts` | POST | `id`（同上） |
| `app/api/cases/[id]/defense/route.ts` | GET, POST | `id`（`resolveAuth` 呼び出し前） |
| `app/api/cases/[id]/defense/draft/route.ts` | POST | `id`（ゲスト/認証分岐より前） |
| `app/api/cases/[id]/verdict/route.ts` | POST | `id` |
| `app/api/friends/[id]/route.ts` | DELETE | `id` |
| `app/api/friends/requests/[id]/route.ts` | PATCH | `id` |

### LOW-002: fetch ステータス検査

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/laws/_components/PendingInvitations.tsx` | 変更 | `respond()` に `res.ok` 検査・`error` state・`rose-*` インラインエラー表示を追加 |

---

## 実装上の判断・設計書からの逸脱

設計書（`docs/knowledge/design.md`「LOW バッチ対応: UUID バリデーション共通化 + fetch ステータス検査」）と引き継ぎメモ（`arch-to-eng.md`）に忠実に実装した。**設計からの逸脱なし**。判断点を以下に再掲する。

1. **`UUID_REGEX` リテラルは逐語移設**: 既存 3 ファイル（invitations / owner / friends-requests）の定義は **3 つとも完全一致**（`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`）だった。差異は無かったため `arch-to-eng.md`「未解決事項 1」の報告フローは発動せず、そのまま `lib/text-utils.ts` へ移設した。新しい正規表現は起こしていない。

2. **ボディ検証は参照差し替えのみ**: `invitee_id` / `new_owner_id` / `receiver_id` の検証は `UUID_REGEX.test(...)` の呼び出しをそのまま残し、参照元を共通 import に変えただけ。判定式は不変（`isUuid` への書き換えもしていない＝挙動完全一致を機械的に担保）。

3. **動的セグメントは全数が UUID カラム参照**だった（grep で全 15 ルートを確認）。
   - `cases.id`（`supabase/schema.sql` L57: `uuid` PK）、`friend_requests.id`（`20260526000002_feat002_phase2_friends.sql` L4: `uuid` PK）、laws 系各テーブルの主キー/外部キーいずれも UUID。
   - リテラルセグメント `me`（`/members/me`）のみ対象外。`arch-to-eng.md`「未解決事項 2」で示された候補（cases 系・friends 系）はすべて UUID カラムを指すため、判定ルールどおり全数ガード対象とした。「UUID を指さない動的セグメント」は **存在しなかった**。

4. **ガードの配置**: 各メソッドハンドラで `await params` 直後・あらゆる DB アクセスより前に置いた。
   - **cases 系のゲスト/認証分岐ルート**（`route.ts` の GET/PATCH、`argument`、`defense`、`defense/draft`）では、`createSessionClient()` / `verifyGuestToken()` / `resolveAuth()` などの分岐ロジックより前にガードを置き、**両経路に等しく適用**した。不正 ID は認証状態に関わらず DB 到達前に 400 で遮断される。
   - `friends/[id]` DELETE・`friends/requests/[id]` PATCH は、`id` を使った DB クエリ（`.eq("id", id)`）より前にガードを置いた。

5. **400 レスポンス形状**: 全ルートで既存の 400 と同形の `NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 })` に統一。
   - 各ファイルの既存 400 はすべて `{ error: string }`・日本語メッセージで揃っていたため、`error` キーは変えていない（フロント互換維持）。
   - パスパラメータの 400 には固有メッセージが既存に無く、ファイル間で文体が混在していたため、設計の指示どおり**短い汎用メッセージ**で統一した。
   - **生のパス値はレスポンス・ログに一切エコーしていない**（本指摘の趣旨＝情報漏洩・ログ汚染の回避）。

6. **LOW-002 のエラー表示**: 既存 `app/components/ErrorBanner.tsx` はフラッシュ Cookie 連携・固定メッセージ辞書（`errorCode` props）専用で、本用途（任意の動的メッセージのインライン表示）には**形が合わなかった**ため、設計のフォールバックどおり最小インライン表示（`<p className="text-sm text-rose-600" role="alert">`）を「届いた招待」見出し直下に配置した。
   - 成功時（`res.ok`）のみ `router.refresh()`。失敗時はリフレッシュを抑止し招待行を残す。
   - `respond()` 先頭で `setError(null)` クリア → 連打時に古いエラーが残らない。
   - `processingId` リセットは `finally` で維持（成功・失敗いずれもボタン解除）。
   - ネットワーク断（`fetch` reject）も `catch` で別メッセージ表示。
   - **配色厳守**: エラーは `rose-600`。`brand-*`・`brand-500` は不使用。

---

## テスタ・オーディへの注意点

### 前提条件

- **DB / migration の適用は不要**。本 PR は **アプリケーションコードのみ**で、`supabase/` 配下・RLS・スキーマには一切手を加えていない。
- 正常系（正しい UUID のリクエスト、成功レスポンス時の `router.refresh()`）の挙動は**従来と完全に同一**。差分は「不正 ID 入力時の 400」と「fetch 失敗時のエラー表示」のみ。

### 重点確認ポイント（`arch-to-eng.md` S1〜S8 準拠）

| シナリオ | 期待される挙動 |
|---|---|
| S1（正常系不変） | 正しい UUID で laws 系・cases 系・friends 系の各ルートを叩くと従来どおりの正常レスポンス |
| S2（不正パス→400） | `lawId` 等に `abc` / `123` / 空文字 / `../` 等を渡すと、**DB 到達前に 400**（`{ error: "不正な ID 形式です" }`）。500・PostgreSQL エラー漏洩が起きない |
| S3（複数セグメント） | `invId` / `propId` のいずれか片方だけ不正でも 400 |
| S4（ゲスト経路） | cases 系で不正 `id` を渡すと、ゲスト/認証チェックより前に 400 で遮断 |
| S5（重複解消の無害性） | ボディ側 UUID 検証（`invitee_id` / `new_owner_id` / `receiver_id`）が共通 import 化後も従来と同一挙動 |
| S6（LOW-002 成功時） | 招待を承認/拒否し API が 2xx を返すと従来どおりリスト更新（`router.refresh()`） |
| S7（LOW-002 失敗時） | API が 403/404/500 を返すケースで、**リフレッシュが走らず**、`rose-600` のエラーが表示され招待行が残る |
| S8（連打抑止） | 失敗後に再押下すると先頭で旧エラーがクリアされてから再試行。`processingId` は `finally` で必ず解除されボタンが固まらない |

### 確認時の留意事項

- **エラー再現方法（LOW-002）**: 既に処理済みの招待（409）や、他人宛招待（403）を `respond()` させると `!res.ok` 経路に入る。UI から自然に出しにくい場合は DevTools のネットワーク改ざん等で 4xx/5xx を再現して確認のこと。
- **UUID ガードの正常系誤弾き**: 早期 return の条件ミスで正しい UUID を弾いていないか、S1 で各ルートを必ず通すこと。`isUuid` は大小文字無視（`/i`）・version 4 形式（3 ブロック目先頭 `4`・4 ブロック目先頭 `[89ab]`）。**v4 以外の UUID は 400 になる**が、本コードベースの ID はすべて `gen_random_uuid()`（v4）生成のため正常系に影響しない。
- **型・lint**: `npx tsc --noEmit` および `npx eslint` ともにエラーゼロを確認済み。

---

## 未実装・スコープ外にしたこと

| 項目 | 理由 |
|---|---|
| RLS / migration / DB スキーマの変更 | task.md・設計書で明示的にスコープ外。`supabase/` 配下は未変更 |
| `profiles` テーブル関連 | スコープ外（別 backlog） |
| ボディ側 UUID 検証**ロジック**の変更 | 共通 `UUID_REGEX` への参照差し替えのみ可。判定式・正規表現リテラルは不変 |
| backlog の他 LOW（`package.json` の `name` 変更ログ、`@upstash/core-analytics` 検証） | スコープ外 |
| FEAT-004（法案 Hub）/ MON-001 / MON-002 | スコープ外 |
