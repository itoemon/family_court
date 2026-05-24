# アーキ → ビルド handoff

## タスク概要

矛盾チェック機能の実装。ユーザーが発言投稿後に過去の自分の発言と AI が非同期で比較し、矛盾があればタイムラインに警告バブルを表示する。

## 実装チェックリスト（この順で実装すること）

### 1. マイグレーション

`supabase/migrations/20260524210000_create_contradiction_warnings.sql` を新規作成:

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

### 2. lib/types.ts（変更）

追加する型:

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

### 3. lib/contradiction.ts（新規作成）

```ts
import Anthropic from "@anthropic-ai/sdk";

interface ContradictionParams {
  currentContent: string;
  topic: string;
  pastArguments: string[];
}

export async function checkContradiction(
  params: ContradictionParams,
  apiKey: string
): Promise<string | null> {
  const { currentContent, topic, pastArguments } = params;
  const client = new Anthropic({ apiKey });

  const prompt = `あなたは話し合いの公正な観察者です。以下の「今回の発言」が「過去の発言リスト」の内容と矛盾しているか判定してください。

<topic>${topic}</topic>

<current_argument>${currentContent}</current_argument>

<past_arguments>
${pastArguments.map((a, i) => `[${i + 1}] ${a}`).join("\n")}
</past_arguments>

明確な矛盾（過去に主張したことと正反対の立場をとっている等）がある場合のみ、50文字以内の日本語で警告メッセージを出力してください。
矛盾がない場合、または判断できない場合は「なし」とだけ出力してください。
前置きや説明は不要です。警告メッセージまたは「なし」のみを出力してください。`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text.trim() : "なし";
  return text === "なし" ? null : text;
}
```

### 4. app/components/ContradictionWarningBubble.tsx（新規作成）

```tsx
import { ContradictionWarning } from "@/lib/types";

export default function ContradictionWarningBubble({ warning }: { warning: ContradictionWarning }) {
  return (
    <div className="flex justify-center my-1">
      <div className="inline-flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 max-w-sm text-sm text-amber-700">
        <span className="shrink-0 mt-0.5">⚠️</span>
        <p>{warning.message}</p>
      </div>
    </div>
  );
}
```

### 5. lib/case-response.ts（変更）

シグネチャに `userId?: string` を追加:

```ts
export async function buildCaseResponse(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  userId?: string
)
```

import に `ContradictionWarning` を追加。

既存のクエリブロックの後に追加:

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

return オブジェクトに `contradictionWarnings` を追加。

### 6. app/api/cases/[id]/argument/route.ts（変更）

import に `checkContradiction` を追加。

caller 判定ブロックで `authenticatedUserId` を保存:

```ts
let authenticatedUserId: string | null = null;
// user が確認できたら:
authenticatedUserId = user.id;
```

arguments insert を ID 取得に変更:

```ts
const { data: insertedArg } = await admin
  .from("arguments")
  .insert({
    case_id: id,
    role: callerRole,
    phase: c.phase,
    round: c.round,
    content: body.content.trim(),
  })
  .select("id")
  .single();
```

既存の judge ブロックの後（`buildCaseResponse` 呼び出しの前）に矛盾チェックブロックを追加:

```ts
if (authenticatedUserId && insertedArg?.id) {
  try {
    const { data: plaintiffProfile } = await admin
      .from("profiles")
      .select("api_key_encrypted")
      .eq("id", c.plaintiff_id)
      .single();
    if (plaintiffProfile?.api_key_encrypted) {
      const apiKey = decryptApiKey(plaintiffProfile.api_key_encrypted);
      const { data: pastCases } = await admin
        .from("cases")
        .select("id")
        .or(`plaintiff_id.eq.${authenticatedUserId},defendant_id.eq.${authenticatedUserId}`)
        .eq("phase", "verdict")
        .neq("id", id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (pastCases && pastCases.length > 0) {
        const { data: pastArgs } = await admin
          .from("arguments")
          .select("content")
          .in("case_id", pastCases.map((pc) => pc.id))
          .eq("role", callerRole)
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

`buildCaseResponse` 呼び出しを変更:

```ts
const caseData = await buildCaseResponse(admin, id, authenticatedUserId ?? undefined);
```

### 7. app/api/cases/[id]/route.ts（変更）

GET ハンドラ冒頭に userId 取得を追加（既存のセッション確認があれば流用、なければ追加）:

```ts
const supabase = await createSessionClient();
const { data: { user } } = await supabase.auth.getUser();
// ...
const caseData = await buildCaseResponse(admin, id, user?.id);
```

### 8. app/case/[id]/page.tsx（変更）

import 追加:

```ts
import { Case, Role, Argument, JudgeMessage, ContradictionWarning } from "@/lib/types";
import ContradictionWarningBubble from "@/app/components/ContradictionWarningBubble";
```

タイムライン内の argument レンダリングを変更:

```tsx
const arg = item.data;
const isPlaintiff = arg.role === "plaintiff";
const name = isPlaintiff ? caseData.plaintiff?.name : caseData.defendant?.name;
const warning = myRole === arg.role
  ? (caseData.contradictionWarnings ?? []).find((w) => w.argumentId === arg.id)
  : undefined;
return (
  <div key={arg.id}>
    <div className={`flex flex-col ${isPlaintiff ? "items-start" : "items-end"}`}>
      {/* 既存の発言バブル（変更なし） */}
    </div>
    {warning && <ContradictionWarningBubble warning={warning} />}
  </div>
);
```

`key` は外側の `<div>` に移動すること（内側の `flex flex-col` div には不要）。

## 注意事項

- 矛盾チェックは **全て try-catch で囲み**、失敗してもレスポンスに影響させない
- `api_key_encrypted` がない場合はスキップ（warn ログ不要、`judge` と同じ扱い）
- ゲスト（`authenticatedUserId === null`）はチェックをスキップ
- `contradiction_warnings` テーブルへの INSERT は admin クライアント経由のみ
- `callerRole` が同一の過去発言のみ比較する（原告は原告、被告は被告）
