# 詳細設計書

## 概要（変更の目的・背景）

PR #3（GitHub Copilot レビュー）の指摘対応として、以下 4 件のバグを修正する。

| # | 重要度 | 内容 |
|---|--------|------|
| 1 | CRITICAL | ゲスト被告の `myRole` がページリロード後に null になり、発言フォームが表示されない |
| 2 | MEDIUM | `setHasApiKey` が表示名のみ更新の場合でも `true` になる |
| 3 | MEDIUM | `GUEST_TOKEN_SECRET` 未設定時に non-null アサーション（`!`）が TypeError を引き起こす |
| 4 | LOW | プロフィール保存の catch 節で `err.message` が表示に反映されない |

新機能追加・DBスキーマ変更・UIデザイン変更はいずれも含まない。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### GET /api/cases/[id]（変更）

レスポンスに `callerRole` フィールドを追加する。

**レスポンス（変更後）**:

```json
{
  "case": { ... },
  "callerRole": "plaintiff" | "defendant" | "observer"
}
```

**`callerRole` の決定ロジック（サーバー側で完結）**:

```
1. createSessionClient().auth.getUser() を呼ぶ
2. 認証済みユーザーが存在する場合:
   a. user.id === case.plaintiff_id              → "plaintiff"
   b. user.id === case.defendant_id（非 null）  → "defendant"
   c. 上記以外                                  → "observer"
3. 未認証の場合:
   a. req.cookies.get(`guest_defendant_${id}`)?.value を取得
   b. verifyGuestToken(id, cookieToken) === true → "defendant"
   c. Cookie なし / 検証失敗                    → "observer"
```

Cookie 名 `guest_defendant_{caseId}` は HIGH-001（コミット a83e17b）で確立した規則に従う。

**ステータスコード**: 変更なし（200 / 404）

---

### PUT /api/profile（変更）

保存後の API キー登録状態をレスポンスに追加する。

**レスポンス（変更後）**:

```json
{
  "hasApiKey": true | false
}
```

`hasApiKey` の算出: 更新処理完了後に `profiles.api_key_encrypted` の現在値をサーバー側で確認し、非 null・非空文字列であれば `true` とする。リクエストに API キーが含まれていたかどうかとは独立した算出であり、サーバーが唯一の事実源となる。

---

## データモデル（DB スキーマ・型定義の変更）

変更なし。

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### lib/guest-token.ts（変更）

**変更内容**: `generateGuestToken` および `verifyGuestToken` の両関数の先頭に環境変数ガードを追加し、`!` アサーションを除去する。

```typescript
// 両関数共通のガード（関数内先頭に配置）
if (!process.env.GUEST_TOKEN_SECRET) {
  throw new Error("GUEST_TOKEN_SECRET is not set");
}
```

設計判断:

- **関数内ガードを採用する理由**: task.md が「関数内で明示的にガードし、未設定時は原因が追えるエラーを返すこと（500 + 説明文）」と明記しているため。バックログが提案するモジュールトップレベルでの throw は今回のスコープ外。
- **API Route 側の責務**: この関数を呼び出す各 API Route の catch ブロックで当該 Error を捕捉し、`{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }` を 500 で返す。スタックトレース・環境変数名はクライアントに渡さない。

---

### app/api/cases/[id]/route.ts（変更: GET ハンドラ）

ケース取得処理に続いて `callerRole` を算出し、既存レスポンスに付与して返す。

```typescript
// callerRole 算出
let callerRole: "plaintiff" | "defendant" | "observer" = "observer";

const supabase = await createSessionClient();
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  if (user.id === caseData.plaintiff_id) {
    callerRole = "plaintiff";
  } else if (caseData.defendant_id && user.id === caseData.defendant_id) {
    callerRole = "defendant";
  }
} else if (caseData.defendant_guest_name) {
  const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
  if (cookieToken && verifyGuestToken(id, cookieToken)) {
    callerRole = "defendant";
  }
}

return NextResponse.json({ ...existingResponse, callerRole });
```

インポート追加: `createSessionClient` from `@/lib/supabase/server`、`verifyGuestToken` from `@/lib/guest-token`。

---

### app/api/profile/route.ts（変更: PUT ハンドラ）

保存処理完了後、更新後の `profiles.api_key_encrypted` を確認して `hasApiKey` を算出し、レスポンスに含める。

```typescript
return NextResponse.json({ hasApiKey: !!updatedProfile.api_key_encrypted });
```

---

### app/case/[id]/page.tsx（変更）

`GET /api/cases/[id]` のレスポンスから `callerRole` を取得し、`setMyRole(data.callerRole)` で `myRole` 状態を設定する。

`defendantId` との UUID 比較によるロール判定コードは削除する。サーバー側で判定が完結するためクライアントが UUID を必要とする理由がなくなる。

---

### app/profile/page.tsx（変更: 2 箇所）

**箇所 1 — `setHasApiKey` の状態同期**

```typescript
// 変更前
setHasApiKey(true);

// 変更後
setHasApiKey(data.hasApiKey);
```

**箇所 2 — catch でのエラーメッセージ表示**

```typescript
// 変更後
catch (err: unknown) {
  const message = err instanceof Error ? err.message : "保存中にエラーが発生しました";
  setError(message);
}
```

---

## セキュリティ設計（認証・認可・入力検証の方針）

### callerRole 決定はサーバー側で完結させる

クライアントはロール文字列（`"plaintiff"` / `"defendant"` / `"observer"`）のみを受け取る。UUID（`defendant_id` / `plaintiff_id`）との照合はサーバー側でのみ行い、クライアントに UUID を渡してロール判定させる設計を廃止する。

`verifyGuestToken` による HMAC 検証もサーバー側のみで実行する。

### GUEST_TOKEN_SECRET エラーのクライアント隠蔽

`guest-token.ts` が throw したエラーを API Route が catch する際、スタックトレースや環境変数名を含む raw エラーメッセージはクライアントに渡さない。サーバーログには詳細を残す。

### getUser() の遵守

`createSessionClient().auth.getUser()` を使用する（`getSession()` 禁止: 要件定義書§セキュリティの規則）。`getUser()` はサーバー側で Supabase Auth へ検証リクエストを送るため、改ざんされた JWT を拒否できる。

---

## 制約・前提条件

1. **HIGH-001 実装済みが前提**: Cookie 名 `guest_defendant_{caseId}` および `generateGuestToken` / `verifyGuestToken` は HIGH-001（コミット a83e17b）で実装済みであること。

2. **バックログ MEDIUM-001（UUID のクライアント公開）はスコープ外**: `callerRole` の追加でクライアントが UUID に依存する必要はなくなるが、GET レスポンスから `plaintiff_id` / `defendant_id` フィールドを除外する作業は別タスクとする。

3. **バックログ MEDIUM-002**（HMAC の決定論的問題）・**LOW-001**（ゲスト名最大長）・**LOW-001 claude.ts**（validateApiKey のエラー区別）はスコープ外。

4. **モジュールトップレベルでの GUEST_TOKEN_SECRET チェック（バックログ提案）はスコープ外**: task.md が「関数内ガード」を指示しているため今回はそちらを優先する。
