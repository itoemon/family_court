# 詳細設計書

## 概要（変更の目的・背景）

矛盾チェック機能を追加する。ユーザーが発言を投稿した直後に、過去の自分の発言と矛盾していないかを AI が非同期で検出し、矛盾が検出された場合のみ警告をタイムラインに表示する。

発言者本人にのみ警告を表示する（相手・observer には見せない）。
ゲストユーザー（defendant_guest_name）は永続 ID がないためスキップ。

---

## API 仕様（変更・追加するエンドポイント）

### POST /api/cases/[id]/argument（変更）

発言挿入後、以下を追加実行する：
1. `arguments` テーブルの insert に `.select("id").single()` を追加してIDを取得
2. 認証済みユーザーのみ、矛盾チェックを try-catch で非同期実行
3. `buildCaseResponse` に `userId` を追加で渡す

### GET /api/cases/[id]（変更）

セッションからユーザーIDを取得し、`buildCaseResponse` に渡す。

---

## データモデル

### 新規テーブル: `contradiction_warnings`

```sql
CREATE TABLE contradiction_warnings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  argument_id uuid NOT NULL REFERENCES arguments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  message     text NOT NULL CHECK (message <> ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contradiction_warnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own warnings"
  ON contradiction_warnings FOR SELECT
  USING (user_id = auth.uid());
```

マイグレーションファイル: `supabase/migrations/20260524210000_create_contradiction_warnings.sql`

### TypeScript 型定義（lib/types.ts への追加）

```ts
export interface ContradictionWarning {
  id: string;
  argumentId: string;
  message: string;
  createdAt: string;
}
```

`Case` インターフェースに追加:
```ts
contradictionWarnings: ContradictionWarning[];
```

---

## コンポーネント設計

### 新規: `lib/contradiction.ts`

```ts
export interface ContradictionParams {
  currentContent: string;
  topic: string;
  pastArguments: string[]; // 直近3ケース × 最大5発言 = 最大15件
}

export async function checkContradiction(
  params: ContradictionParams,
  apiKey: string
): Promise<string | null>
```

- モデル: `claude-haiku-4-5-20251001`
- max_tokens: 128
- 矛盾なし → `null` を返す
- 矛盾あり → 50文字以内の日本語警告メッセージを返す
- プロンプトはユーザー入力を XML タグで囲む（プロンプトインジェクション対策）

プロンプト設計:
```
あなたは話し合いの公正な観察者です。以下の「今回の発言」が「過去の発言リスト」の内容と矛盾しているか判定してください。

<topic>${topic}</topic>

<current_argument>${currentContent}</current_argument>

<past_arguments>
${pastArguments.map((a, i) => `[${i + 1}] ${a}`).join('\n')}
</past_arguments>

明確な矛盾（過去に主張したことと正反対の立場をとっている等）がある場合のみ、50文字以内の日本語で警告メッセージを出力してください。
矛盾がない場合、または判断できない場合は「なし」とだけ出力してください。
前置きや説明は不要です。警告メッセージまたは「なし」のみを出力してください。
```

出力が `"なし"` の場合は `null` を返す。

### 新規: `app/components/ContradictionWarningBubble.tsx`

- ⚠️ アイコン + amber 系配色
- judge バブルと区別するため amber-100 背景、amber-600 テキスト
- 中央寄せ

```tsx
export default function ContradictionWarningBubble({ warning }: { warning: ContradictionWarning }) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 max-w-sm text-sm text-amber-700">
        <span className="shrink-0 mt-0.5">⚠️</span>
        <p>{warning.message}</p>
      </div>
    </div>
  );
}
```

### 変更: `lib/case-response.ts`

シグネチャ変更:
```ts
export async function buildCaseResponse(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  userId?: string
)
```

`userId` が渡された場合のみ contradiction_warnings をクエリ:
```ts
let contradictionWarnings: ContradictionWarning[] = [];
if (userId) {
  const { data: warnings } = await admin
    .from("contradiction_warnings")
    .select("id, argument_id, message, created_at")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at");
  contradictionWarnings = (warnings ?? []).map((w) => ({
    id: w.id,
    argumentId: w.argument_id,
    message: w.message,
    createdAt: w.created_at,
  }));
}
```

レスポンスオブジェクトに追加:
```ts
contradictionWarnings,
```

### 変更: `app/api/cases/[id]/argument/route.ts`

1. arguments insert にIDを返す処理を追加:
```ts
const { data: insertedArg } = await admin
  .from("arguments")
  .insert({ case_id: id, role: callerRole, phase: c.phase, round: c.round, content: body.content.trim() })
  .select("id")
  .single();
```

2. 既存の judge ブロックの後に矛盾チェックブロックを追加（認証済みユーザーのみ）:
```ts
// 矛盾チェック（認証済みユーザーのみ、失敗しても無視）
if (authenticatedUserId && insertedArg?.id) {
  // ← authenticatedUserId は caller 判定時に保存しておく
  try {
    const { data: plaintiffProfile } = await admin
      .from("profiles")
      .select("api_key_encrypted")
      .eq("id", c.plaintiff_id)
      .single();
    if (plaintiffProfile?.api_key_encrypted) {
      const apiKey = decryptApiKey(plaintiffProfile.api_key_encrypted);

      // 直近3件の過去ケース（verdict）を取得
      const { data: pastCases } = await admin
        .from("cases")
        .select("id")
        .or(`plaintiff_id.eq.${authenticatedUserId},defendant_id.eq.${authenticatedUserId}`)
        .eq("phase", "verdict")
        .neq("id", id)
        .order("created_at", { ascending: false })
        .limit(3);

      if (pastCases && pastCases.length > 0) {
        const pastCaseIds = pastCases.map((pc) => pc.id);
        const { data: pastArgs } = await admin
          .from("arguments")
          .select("content, case_id")
          .in("case_id", pastCaseIds)
          .eq("role", callerRole)  // 同じロール（原告→原告, 被告→被告）で比較
          .order("created_at", { ascending: false })
          .limit(15);

        if (pastArgs && pastArgs.length > 0) {
          const warning = await checkContradiction({
            currentContent: body.content.trim(),
            topic: c.topic,
            pastArguments: pastArgs.map((a) => a.content),
          }, apiKey);

          if (warning) {
            await admin.from("contradiction_warnings").insert({
              case_id: id,
              argument_id: insertedArg.id,
              user_id: authenticatedUserId,
              message: warning,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[contradiction] check failed:", err);
  }
}
```

3. `buildCaseResponse` 呼び出しに `authenticatedUserId` を追加:
```ts
const caseData = await buildCaseResponse(admin, id, authenticatedUserId ?? undefined);
```

4. caller 判定ブロックで `authenticatedUserId` を保存:
```ts
let authenticatedUserId: string | null = null;
// ...
if (user) {
  authenticatedUserId = user.id;
  // ...
}
```

### 変更: `app/api/cases/[id]/route.ts`

GET ハンドラで userId を取得して buildCaseResponse に渡す:
```ts
const supabase = await createSessionClient();
const { data: { user } } = await supabase.auth.getUser();
const caseData = await buildCaseResponse(admin, id, user?.id);
```

### 変更: `app/case/[id]/page.tsx`

1. import に `ContradictionWarning` 追加
2. import `ContradictionWarningBubble`
3. タイムラインの argument レンダリング後に警告バブルを挿入:
```tsx
const arg = item.data;
const isPlaintiff = arg.role === "plaintiff";
const name = isPlaintiff ? caseData.plaintiff?.name : caseData.defendant?.name;
const warning = myRole === arg.role
  ? caseData.contradictionWarnings.find((w) => w.argumentId === arg.id)
  : undefined;
return (
  <div key={arg.id}>
    <div className={`flex flex-col ${isPlaintiff ? "items-start" : "items-end"}`}>
      {/* 既存の発言バブル */}
    </div>
    {warning && <ContradictionWarningBubble warning={warning} />}
  </div>
);
```

---

## セキュリティ設計

- **RLS**: `contradiction_warnings` は `user_id = auth.uid()` でのみ SELECT 可。INSERT は admin クライアント経由のみ（クライアント側から直接書き込み不可）
- **プロンプトインジェクション対策**: topic・currentContent・pastArguments を XML タグで囲み構造分離
- **API キー不在**: `api_key_encrypted` がない場合は矛盾チェックをスキップ（warn ログのみ）
- **ゲスト除外**: `authenticatedUserId` が null の場合チェックをスキップ

---

## 制約・スコープ外

- 相手の発言との矛盾チェック（自分の過去発言との比較のみ）
- ゲストユーザーの矛盾チェック
- 矛盾の深刻度分類
- 警告の非表示・スヌーズ機能
- ページネーション（過去ケースは直近3件固定）
