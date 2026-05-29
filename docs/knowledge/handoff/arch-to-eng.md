# アーキ → ビルド 引き継ぎメモ

## タスク概要

監査由来の LOW バッチ 2 件（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md` の LOW-001 / LOW-002）を 1 PR で対応する。**アプリケーションコードのみ**の品質改善であり、**RLS / migration / DB スキーマには一切手を加えない**。

詳細設計は `docs/knowledge/design.md` の **「LOW バッチ対応: UUID バリデーション共通化 + fetch ステータス検査」** セクションを参照すること。

- **LOW-001**: `UUID_REGEX` の重複定義を共通化し、UUID 型カラムを参照する API パスパラメータに先頭ガードを追加（不正なら 400）。
- **LOW-002**: `PendingInvitations.tsx` の `respond()` で `res.ok` を検査し、失敗時はエラー表示＆リフレッシュ抑止。

**最重要事項**: `supabase/` 配下・RLS・migration には**触らない**。正常系（正しい UUID / 成功レスポンス）の挙動を**一切変えない**。

---

## 実装順序

順序を守ると各ステップ単体で検証しやすい。

### Step 1: `UUID_REGEX` / `isUuid` を `lib/text-utils.ts` に集約

1. 既存 3 ファイルのいずれかにある `UUID_REGEX` のリテラルを確認する：
   - `app/api/laws/[id]/invitations/route.ts`
   - `app/api/friends/requests/route.ts`
   - `app/api/laws/[id]/owner/route.ts`
2. **そのリテラルを一字一句そのまま** `lib/text-utils.ts` に移設し、併せて型ガードを追加する：

   ```typescript
   export const UUID_REGEX = /* 既存リテラルをそのまま */;
   export function isUuid(value: unknown): value is string {
     return typeof value === "string" && UUID_REGEX.test(value);
   }
   ```

3. **新しい正規表現を起こさないこと**（挙動変化＝リグレッション禁止）。
4. 3 ファイルの定義が相互に**異なっていた場合は統一せず、差異を報告**してリード/task.md に判断を仰ぐ（後述「未解決事項 1」）。

> 配置先を `lib/text-utils.ts` にした理由は design.md「LOW-001 設計 / 1. UUID_REGEX 共通化の配置と公開 API」のトレードオフ節を参照（既存の文字列ヘルパーと同ファミリー・新規 catch-all ファイルを増やさない判断）。

### Step 2: 重複定義の置き換え（挙動不変）

上記 3 ファイルのローカル `UUID_REGEX` 定義を削除し、`import { UUID_REGEX } from "@/lib/text-utils"`（実際の import パス記法は既存ファイルに合わせる）へ差し替える。

- **ボディ検証の判定式は変えない**。`UUID_REGEX.test(...)` の呼び出しはそのまま、参照元だけを共通 import にする。
- `friends/requests/route.ts` は動的セグメントを持たない。このファイルは**参照差し替えのみ**で、パスガードは追加しない。

### Step 3: パスパラメータ UUID ガードの追加

#### 3-a. 対象ルートを grep で全数確定する

design.md の確定対象（laws ツリー）に加え、cases 系・friends 系の候補を grep で実在確認する。

```
# 動的セグメントを持つ Route Handler を洗い出す
rg --files app/api | rg "\[.*\]"

# 各 route.ts で params から取り出した値が UUID カラムに渡る箇所を確認
rg -n "params" app/api --glob "**/route.ts"
rg -n "\.eq\(" app/api --glob "**/route.ts"
```

確定対象（design.md より。確実に対象）:

| ルートファイル | メソッド | ガード対象 |
|---------------|---------|-----------|
| `app/api/laws/[id]/route.ts` | GET | `id` |
| `app/api/laws/[id]/invitations/route.ts` | POST | `id` |
| `app/api/laws/[id]/invitations/[invId]/route.ts` | PATCH | `id`, `invId` |
| `app/api/laws/[id]/members/me/route.ts` | DELETE | `id`（`me` はリテラル・対象外） |
| `app/api/laws/[id]/owner/route.ts` | PATCH | `id` |
| `app/api/laws/[id]/proposals/route.ts` | POST | `id` |
| `app/api/laws/[id]/proposals/[propId]/route.ts` | DELETE | `id`, `propId` |
| `app/api/laws/[id]/proposals/[propId]/votes/route.ts` | POST | `id`, `propId` |

要 grep 確定の候補（実在・メソッド・カラム種別を確認のうえ対象化）:

- `app/api/cases/[id]/**`（argument / defense / draft 等）— **ゲスト経路・認証経路の双方**でガードを通すこと。
- `app/api/friends/requests/[id]/**`（PR #20 の承認/拒否/削除が path param 経由なら対象）。

**判定ルール**: 動的セグメント `[xxx]` の値が UUID 型カラム（`id` / `law_id` / `invitee_id` 等）への `.eq(...)` 等に渡るなら対象。リテラルセグメント（`me` 等）は対象外。本コードベースでは動的セグメントは事実上すべて UUID なので「`[param]` 形式の動的セグメントはすべてガード」を既定としてよい。

#### 3-b. 各メソッドハンドラ先頭にガードを置く

```typescript
import { isUuid } from "@/lib/text-utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; invId: string }> }) {
  const { id, invId } = await params;        // ※ params が Promise か否かは要確認（下記）
  if (!isUuid(id) || !isUuid(invId)) {
    return Response.json({ error: /* 既存 400 と同形式 */ }, { status: 400 });
  }
  // 以降の既存処理は一切変更しない
}
```

- ガードは `params` 取得**直後・あらゆる DB アクセスより前**。
- case 系のゲスト/認証分岐があるルートは、**分岐より前**にガードを置き両経路に適用する。
- 複数セグメントは全数検証（いずれか不正なら 400）。
- **400 のレスポンス形状は同一ファイル内の既存 400 に厳密に合わせる**（`{ error: string }` 等）。メッセージは既存の言語・文体に合わせ、判断つかなければ短い汎用文（例 `"不正な ID 形式です"`）。**生のパス値をレスポンス/ログにエコーしない**。

### Step 4: `PendingInvitations.tsx` の fetch ステータス検査（LOW-002）

対象: `app/laws/_components/PendingInvitations.tsx` の `respond()`。

```
setProcessingId(id); setError(null)
try {
  const res = await fetch(...)
  if (!res.ok) { setError(<失敗メッセージ>); return }   // ← refresh しない
  router.refresh()                                       // ← 成功時のみ
} finally { setProcessingId(null) }                       // ← 既存の finally を維持
```

- `error` state（`useState<string | null>(null)`）を 1 つ追加。`respond()` 先頭で `null` クリア。
- エラー表示は**既存 `ErrorBanner`（PR #13 B-2）が再利用可能ならそれを使う**。なければ最小インライン（例 `<p className="text-sm text-rose-600">{error}</p>`）。
- **配色厳守**: エラーは `rose-*`、プライマリは `brand-700/800`、`brand-500` 不使用。エラー表示に `brand-*` を使わない。

### Step 5: Next.js バージョン確認

`AGENTS.md` の方針に従い、本バージョンの Route Handler の `params` 取得方法（`Promise` か否か、`await` 要否）を `node_modules/next/dist/docs/` で確認してからガードを書く。既存 laws ルートが既に採っている書き方に合わせるのが安全。

---

## 設計判断の理由

### `UUID_REGEX` / `isUuid` を `lib/text-utils.ts` に置く理由

`isUuid` は本質的に「文字列形式の述語」であり、既存の `truncate` / `escapeXml` 等と同じ純粋文字列ヘルパーのファミリーに属する。新規 `lib/utils.ts` は意味的には素直だが、汎用 util ファイルは将来あらゆるものが流入する catch-all 化を招きやすく、関数 1 つのために新ファイルを作るコストにも見合わない。既存構成との一貫性と最小差分を優先した。

### 既存 `UUID_REGEX` リテラルをそのまま移設する理由

新しい正規表現を起こすと、ボディ検証の判定が微妙に変わりリグレッションになりうる。本タスクは「正常系の挙動を一切変えない」が絶対条件のため、検証ロジックの同一性を機械的に担保する最も安全な方法として、既存リテラルの逐語移設を選んだ。

### ガードを各メソッドハンドラ先頭・DB アクセス前に置く理由

本指摘の本質は「不正な ID が PostgreSQL まで到達し、500 として漏洩・ログ汚染する」こと。最先頭で 400 を返せば、DB へ到達する前に統一形式で遮断でき、ゲスト/認証の分岐前に置くことで認証状態に依らず一様に効く。

### ボディ検証ロジックを変えない理由

ボディ側 UUID 検証は既に正しく機能しており、本タスクのスコープは「重複の共通化」まで。判定式に手を入れると挙動変化のリスクが入るため、参照元の差し替えに限定する。

---

## 実装上の注意事項

- **`supabase/` を開かない・触らない**。RLS / migration / スキーマは本 PR の対象外。
- **`profiles` 関連は触らない**。
- **正常系を壊さない**: 正しい UUID のリクエスト、成功時 `router.refresh()` は従来通り。差分は「不正入力時の 400」と「失敗レスポンス時のエラー表示」のみ。
- **import パス記法**は既存ファイルの慣習（`@/lib/...` か相対か）に合わせる。
- **400 のレスポンス形状**を既存 400 と食い違わせない。クライアント（フロント）が `{ error }` を前提にしている可能性があるため、キー名を変えない。
- ガード追加後、確定対象＋候補ルートのすべてで「正しい UUID は従来通り通る」ことを確認する（早期 return の条件ミスで正常系を弾かないこと）。

---

## 動作確認シナリオ

### LOW-001

- **S1（正常系不変）**: 正しい UUID で各ルート（laws GET/POST invitations/PATCH invitations/[invId]/members me/owner/proposals/[propId]/votes、および確定した cases 系）を叩き、従来と同じ正常レスポンスが返る。
- **S2（不正パス → 400）**: `lawId` 等に `abc`・`123`・空文字・`../` 等の非 UUID を渡し、**DB に到達せず 400**（既存 400 と同形式）が返る。500 や PostgreSQL エラー漏洩が起きないこと。
- **S3（複数セグメント）**: `invId` / `propId` 片方だけ不正でも 400 になる。
- **S4（ゲスト経路）**: cases 系のゲスト経路で不正 `id` を渡しても、認証チェックより前に 400 で遮断される。
- **S5（重複解消の無害性）**: ボディ側 UUID 検証（`invitee_id` / `new_owner_id` / `receiver_id`）が共通 import 化後も従来と同一挙動（正しい UUID は通り、不正は従来通り弾く）。

### LOW-002

- **S6（成功時）**: 招待を承認/拒否し API が 2xx を返すと、従来通りリスト更新（`router.refresh()`）。
- **S7（失敗時）**: API が 403/404/500 を返すケースで、**リフレッシュが走らず**、`rose-*` のエラーが表示され、招待行が残る。
- **S8（連打抑止）**: 失敗後に再度押下すると、先頭で旧エラーがクリアされてから再試行される。`processingId` が `finally` で必ず解除されボタンが固まらない。

---

## 未解決事項・要確認

1. **3 ファイルの `UUID_REGEX` リテラルが相互に異なる可能性**: 逐語移設が前提だが、3 定義が不一致だった場合は**独断で統一せず**、差異内容（どのファイルがどのパターンか）をリード/task.md へ報告して判断を仰ぐこと。
2. **cases 系・friends 系ルートの実在と形**: design.md には laws ツリーしか記録がない。`app/api/cases/[id]/**` や `app/api/friends/requests/[id]/**` の実パス・メソッド・`[id]` が UUID カラムを指すかは grep で確定すること（Step 3-a）。動的セグメントが UUID カラムを指さないルートが見つかった場合はガード対象から外し、その判断を本メモに追記して報告する。
3. **既存 400 のメッセージ・レスポンス形状**: ファイルごとに揺れがある場合は、各ファイルの既存 400 に合わせる。全体で統一されていなければ短い汎用メッセージで揃える方針でよいが、フロントが参照するキー名（`error` 等）は変えないこと。
4. **`ErrorBanner` の再利用可否**: `PendingInvitations.tsx` から `ErrorBanner` の props 形状・配置が流用できるか確認。合わなければ最小インライン表示（`rose-*`）に切り替える。
5. **`params` の取得方法**: 本バージョン Next.js で `params` が `Promise` か否かを確認（Step 5）。既存 laws ルートの書き方に揃えるのが安全。
6. **スコープ厳守**: backlog の他 LOW（`package.json` の `name` 変更ログ、`@upstash/core-analytics` 検証）、FEAT-004 / MON-001 / MON-002、RLS / migration / `profiles` はすべて本 PR スコープ外。混入させないこと。
