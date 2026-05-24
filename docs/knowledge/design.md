# 詳細設計書

## 概要（変更の目的・背景）

現在の話し合いフローは原告・被告が交互に発言するだけで裁判の体裁を欠く。
本タスクは裁判官 AI を司会として追加し、以下 3 種類のメッセージをサーバー側で自動生成・DB 保存し、クライアントで表示する。

| trigger_type | 発生タイミング |
|---|---|
| `opening` | 被告参加 → `opening` フェーズ移行直後（PATCH `/api/cases/[id]`） |
| `turn` | 各発言投稿 → ターン更新直後（POST `/api/cases/[id]/argument`、judging 移行以外） |
| `closing` | 最終発言投稿 → `judging` フェーズ移行直後（POST `/api/cases/[id]/argument`） |

裁判官メッセージは `arguments` テーブルとは独立した専用テーブル `judge_messages` で管理する。クライアントは `arguments` と `judgeMessages` を `created_at` 昇順でマージしてタイムライン表示する。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### GET /api/cases/[id]（変更）

レスポンスに `judgeMessages` 配列を追加する。リクエスト仕様に変更はない。

**レスポンス（変更後、抜粋）**:

```json
{
  "id": "uuid",
  "topic": "...",
  "phase": "opening",
  "arguments": [...],
  "judgeMessages": [
    {
      "id": "uuid",
      "content": "本日の話し合いを開廷します。",
      "triggerType": "opening",
      "createdAt": "2026-05-23T00:00:00Z"
    }
  ],
  "callerRole": "plaintiff"
}
```

`judgeMessages` は `judge_messages` テーブルから `case_id` で絞り、`created_at` 昇順で取得する。クライアントには `case_id` は含めない。

---

### PATCH /api/cases/[id]（変更）

リクエスト仕様に変更はない。レスポンスは `buildCaseResponse` の変更により `judgeMessages` が追加される。

**追加処理（既存の `phase: "opening"` 更新後に実行）**:

1. `cases.plaintiff_id` で `profiles.api_key_encrypted` を取得する
2. `api_key_encrypted` が null または空の場合はスキップ（`console.warn` のみ）
3. `decryptApiKey` で復号し、`generateJudgeMessage` を呼び出す（trigger: `"opening"`）
4. 生成テキストを `judge_messages` に挿入する（`trigger_type: "opening"`）
5. ステップ 1〜4 は全体を try-catch で囲み、例外は `console.error` のみ。メイン処理のレスポンスには影響させない

プロンプト用の名前は以下から取得する:
- 原告名: `profiles.display_name`（`plaintiff_id` で取得）
- 被告名（アカウント参加）: `profiles.display_name`（`defendant_id` で取得）
- 被告名（ゲスト参加）: `body.defendantName.trim()`

---

### POST /api/cases/[id]/argument（変更）

リクエスト仕様に変更はない。レスポンスは `buildCaseResponse` の変更により `judgeMessages` が追加される。

**追加処理（既存の `cases` 更新後に実行）**:

| 条件 | trigger_type | プロンプト追加情報 |
|---|---|---|
| `nextPhase === "judging"` | `"closing"` | `topic` のみ |
| 上記以外 | `"turn"` | `topic`・前発言者名（`callerRole` から）・次発言者名（逆ロール） |

処理の try-catch・スキップ判定は PATCH と同一。

---

## データモデル（DB スキーマ・型定義の変更）

### 新設テーブル `judge_messages`

```sql
create table public.judge_messages (
  id           uuid default gen_random_uuid() primary key,
  case_id      uuid references public.cases(id) on delete cascade not null,
  content      text not null,
  trigger_type text not null check (trigger_type in ('opening', 'turn', 'closing')),
  created_at   timestamptz default now() not null
);

alter table public.judge_messages enable row level security;

create policy "誰でも裁判官メッセージを参照可"
  on public.judge_messages for select
  using (true);

grant select on public.judge_messages to anon;
grant select on public.judge_messages to authenticated;
grant all    on public.judge_messages to service_role;
```

`arguments` テーブルのスキーマ・CHECK 制約（`role in ('plaintiff','defendant')`）は変更しない。

---

### 型定義（lib/types.ts）

以下を追加する:

```typescript
export type JudgeTrigger = "opening" | "turn" | "closing";

export interface JudgeMessage {
  id: string;
  content: string;
  triggerType: JudgeTrigger;
  createdAt: string;
}
```

`Case` インターフェースに追加:

```typescript
judgeMessages: JudgeMessage[];
```

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### lib/judge.ts（新設）

裁判官 AI メッセージ生成の専用モジュール。`lib/claude.ts` のパターンに倣い、Anthropic SDK を直接使用する。

**関数シグネチャ**:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { Role, JudgeTrigger } from "./types";

interface JudgeParams {
  trigger: JudgeTrigger;
  topic: string;
  plaintiffName: string;
  defendantName: string;
  lastSpeakerRole?: Role; // trigger === "turn" のときのみ参照
}

export async function generateJudgeMessage(
  params: JudgeParams,
  apiKey: string
): Promise<string>
```

使用モデル: `claude-haiku-4-5-20251001`（1〜3 文の短い出力にはコスト・速度の観点でHaikuが適切）  
`max_tokens`: 256

**プロンプト仕様**:

| trigger | プロンプト概要 |
|---------|----------------|
| `"opening"` | 開廷宣言を求める。`topic`・`plaintiffName`・`defendantName` を提示。1〜2文。威厳ある中立的言葉のみ出力させる。 |
| `"turn"` | 次ターンへの促しコメントを求める。`topic`・前発言者名と役割・次発言者名と役割を提示。1〜2文。発言内容への評価・介入禁止。 |
| `"closing"` | 閉廷と審議入りを告げる言葉を求める。`topic` を提示。1〜2文。威厳ある中立的言葉のみ出力させる。 |

各プロンプト末尾に「前置きや余分な説明なしで、裁判官の言葉のみを出力してください」を付記する。レスポンスは `message.content[0].type === "text"` で取得し、テキストをそのまま返す。

---

### lib/case-response.ts（変更）

`buildCaseResponse` に `judge_messages` クエリを追加し、戻り値に `judgeMessages` を含める。

```typescript
const { data: judgeMsgs } = await admin
  .from("judge_messages")
  .select("id, content, trigger_type, created_at")
  .eq("case_id", caseId)
  .order("created_at");
```

戻り値に追加:
```typescript
judgeMessages: (judgeMsgs ?? []).map((jm) => ({
  id: jm.id,
  content: jm.content,
  triggerType: jm.trigger_type as JudgeTrigger,
  createdAt: jm.created_at,
})),
```

`JudgeTrigger` は `lib/types.ts` からインポートする。

---

### app/api/cases/[id]/route.ts（変更: PATCH ハンドラ）

`phase: "opening"` への `cases` 更新が完了した後に、裁判官メッセージ生成ブロックを追加する。try-catch で全体を囲み、失敗はレスポンスに影響させない。

追加するインポート: `generateJudgeMessage` from `@/lib/judge`、`decryptApiKey` from `@/lib/crypto`。

---

### app/api/cases/[id]/argument/route.ts（変更: POST ハンドラ）

`cases` 更新完了後に裁判官メッセージ生成ブロックを追加する。`nextPhase` の値で trigger_type を切り替える。try-catch で全体を囲み、失敗はレスポンスに影響させない。

追加するインポート: `generateJudgeMessage` from `@/lib/judge`、`decryptApiKey` from `@/lib/crypto`。

---

### app/components/JudgeMessageBubble.tsx（新設）

裁判官メッセージ専用の表示コンポーネント。

```typescript
interface Props {
  message: JudgeMessage;
}
```

| 属性 | 値 |
|---|---|
| 外側ラッパー | `flex justify-center my-2` |
| バブル | `max-w-[70%] rounded-lg border border-stone-200 bg-stone-100 px-4 py-2` |
| ヘッダー（アイコン＋ラベル） | `flex items-center gap-1 text-stone-400 text-xs mb-1` に ⚖️ と「裁判官」テキスト |
| 本文テキスト | `text-stone-600 text-sm italic text-center` |

デザイン原則（要件定義書§デザイン原則）: stone 系ベーストーン、温かみのある柔らかい雰囲気を維持。

---

### app/case/[id]/page.tsx（変更: タイムライン表示）

`Case.arguments` と `Case.judgeMessages` を `created_at` 昇順でマージした統合タイムライン配列を生成し、`type` で分岐してレンダリングする。

```typescript
type TimelineItem =
  | { type: "argument"; data: Argument }
  | { type: "judge"; data: JudgeMessage };

const timeline: TimelineItem[] = [
  ...(caseData.arguments.map((a) => ({ type: "argument" as const, data: a }))),
  ...(caseData.judgeMessages.map((j) => ({ type: "judge" as const, data: j }))),
].sort((a, b) =>
  new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime()
);
```

`type === "argument"` は既存バブルコンポーネント、`type === "judge"` は `JudgeMessageBubble` を使用。

---

## セキュリティ設計（認証・認可・入力検証の方針）

### APIキーの取得と使用

裁判官メッセージ生成には原告の `profiles.api_key_encrypted` を使用する。ADR-004（BYOK）および既存の判決生成と同一方針。

- `createAdminClient()` で取得（RLS バイパス）
- `decryptApiKey` による復号はサーバー側のみ
- 復号済みキーはリクエストスコープ内で消費し、レスポンスに含めない

### プロンプトへのユーザー入力埋め込み

`topic`・`plaintiffName`・`defendantName` はユーザー入力由来のため、プロンプトへの埋め込みに注意が必要。DB への直接影響はないが、プロンプトインジェクションにより裁判官の発言内容が意図しないものになりうる。これは既存の判決生成でも同様の構造であり、本タスクで新たなリスクが増えるわけではない。

### フェーズ遷移後の生成順序

裁判官メッセージ生成は `cases` テーブルの更新が `await` で完了した後に開始する。DB の不整合（フェーズ未移行のまま裁判官が開廷宣言する等）を防ぐ。

### judge_messages への書き込み権限

`judge_messages` テーブルは `service_role`（`createAdminClient`）のみが書き込める。ユーザー（anon/authenticated）は読み取り専用。裁判官コメントの改ざん・注入はAPIレイヤーで防がれる。

---

## 制約・前提条件

1. **APIキー未登録時の縮退動作**: 原告が API キーを登録していない場合、裁判官メッセージは生成されない。`judgeMessages` は空配列として返り、ケースの進行・判決生成には影響しない。クライアントは空配列を「裁判官コメントなし」として正常に扱うこと。

2. **リアルタイム配信はスコープ外**: 裁判官メッセージは既存のポーリング（GET /api/cases/[id]）で取得される。開廷宣言は PATCH 完了後の `buildCaseResponse` レスポンスに含まれるため、被告側は参加直後に受け取る。原告側は次回ポーリングで受け取る。

3. **弁護人 AI・過去ケース参照はスコープ外**: task.md 明記。

4. **`arguments` テーブルのスキーマ変更なし**: `role = 'judge'` を `arguments` テーブルに追加する案は採用しない。理由は「データモデル」セクション参照。

5. **バックログ未解消の既存問題はスコープ外**: MEDIUM-001（UUID公開）・MEDIUM-002（HMAC決定論的）・各LOW問題は本タスクに影響しない。`judge_messages` テーブル追加によりこれらの問題が悪化しないことを確認済み。
