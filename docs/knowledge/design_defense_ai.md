# 詳細設計書: 弁護人AI機能

## 概要

ケースページ（`/case/[id]`）に弁護人AIチャット機能を追加する。
ユーザーは既存の対話チャット（全員公開）とは別に、自分専用の弁護人AIとの個人チャットを利用できる。
弁護人AIはヒアリングを通じてユーザーの気持ちや主張を整理し、対話チャットへの回答案を生成する。

---

## DBスキーマ

### 新規テーブル: `defense_messages`

```sql
CREATE TABLE defense_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE defense_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own defense messages"
  ON defense_messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own defense messages"
  ON defense_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT ON defense_messages TO authenticated;
GRANT ALL            ON defense_messages TO service_role;
```

**補足**:
- INSERT ポリシーは RLS の整合性のために定義するが、実際の INSERT は `createAdminClient()` 経由で行う。
- ゲストユーザー（`auth.uid()` なし）は利用不可。弁護人AI機能は認証済みユーザーのみ。

### マイグレーションファイル

パス: `supabase/migrations/20260525000000_create_defense_messages.sql`

内容は上記の SQL と同一。

---

## TypeScript 型定義

### `lib/types.ts` への追加

```ts
export interface DefenseMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
```

`Case` インターフェースへの追加は**行わない**。弁護人AIのメッセージは専用エンドポイントから取得するため、ケースデータに混在させない。

---

## APIルート仕様

### POST `/api/cases/[id]/defense`

弁護人AIへのメッセージ送信。ユーザーのメッセージを保存し、AI応答を生成・保存して返却する。

**ファイルパス**: `app/api/cases/[id]/defense/route.ts`

**認証**: 必須（ゲスト不可）

**リクエスト**:

```json
{ "content": "正直に言うと怒りより悲しさの方が大きくて..." }
```

**レスポンス（200）**:

```json
{
  "messages": [
    { "id": "...", "role": "user",      "content": "...", "createdAt": "..." },
    { "id": "...", "role": "assistant", "content": "...", "createdAt": "..." }
  ]
}
```

**エラーレスポンス**:

| ステータス | 条件 |
|-----------|------|
| 400 | content が空または 1000 文字超 |
| 401 | 未認証（ゲスト含む） |
| 403 | 認証済みだが本ケースの参加者でない |
| 404 | ケースが存在しない |
| 500 | AI 呼び出し失敗 / DB 書き込み失敗 |

**処理フロー**:

1. `createSessionClient()` で認証ユーザーを取得。未認証なら 401。
2. `createAdminClient()` でケースを取得。存在しなければ 404。
3. ユーザーが `plaintiff_id` または `defendant_id` と一致するか確認。不一致なら 403（ゲスト参加の被告は弁護人AI利用不可）。
4. `plaintiff_id` のプロフィールから `api_key_encrypted` を取得し復号。
5. `defense_messages` から当該ケース・ユーザーの会話履歴を取得（`created_at` 昇順）。
6. `arguments` テーブルから対話チャット履歴を取得（`created_at` 昇順）。
7. ユーザーのメッセージを `defense_messages` に INSERT（`role: 'user'`）。
8. `lib/defense.ts` の `generateDefenseResponse()` を呼び出して AI 応答を生成。
9. AI 応答を `defense_messages` に INSERT（`role: 'assistant'`）。
10. 最新の会話履歴全件を返却。

---

### POST `/api/cases/[id]/defense/draft`

回答案を生成する。DB への保存は行わない（ステートレス生成）。

**ファイルパス**: `app/api/cases/[id]/defense/draft/route.ts`

**認証**: 必須（ゲスト不可）

**リクエスト**: なし（ボディ不要）

**レスポンス（200）**:

```json
{ "draft": "実は先週から毎日帰りが遅いのが続いていて、寂しい気持ちもあって..." }
```

**エラーレスポンス**:

| ステータス | 条件 |
|-----------|------|
| 401 | 未認証 |
| 403 | ケース参加者でない |
| 404 | ケースが存在しない |
| 422 | 弁護人AI会話履歴が空（ヒアリングなしで生成不可） |
| 500 | AI 呼び出し失敗 |

**処理フロー**:

1. `createSessionClient()` で認証ユーザーを取得。未認証なら 401。
2. `createAdminClient()` でケースを取得。存在しなければ 404。
3. ユーザーが `plaintiff_id` または `defendant_id` と一致するか確認。不一致なら 403。
4. `plaintiff_id` のプロフィールから `api_key_encrypted` を取得し復号。
5. `defense_messages`（当該ユーザー）と `arguments` を取得。
6. `defense_messages` が 0 件なら 422。
7. `lib/defense.ts` の `generateDraft()` を呼び出して回答案を生成。
8. `{ draft: string }` を返却。

---

### GET `/api/cases/[id]/defense`

会話履歴の初期取得（ページロード時）。

**ファイルパス**: `app/api/cases/[id]/defense/route.ts`（同ファイルに `GET` も定義）

**認証**: 必須（ゲスト不可）

**リクエスト**: なし

**レスポンス（200）**:

```json
{
  "messages": [
    { "id": "...", "role": "user",      "content": "...", "createdAt": "..." },
    { "id": "...", "role": "assistant", "content": "...", "createdAt": "..." }
  ]
}
```

**エラーレスポンス**:

| ステータス | 条件 |
|-----------|------|
| 401 | 未認証 |
| 403 | ケース参加者でない |
| 404 | ケースが存在しない |

**処理フロー**:

1. 認証確認・参加者確認（POST と同様）。
2. `defense_messages` を `created_at` 昇順で全件取得。
3. `{ messages }` を返却。

---

## コンポーネント構成

### 新規: `lib/defense.ts`

弁護人AI・回答案生成ロジックをここに集約する。

```ts
import Anthropic from "@anthropic-ai/sdk";
import { DefenseMessage } from "./types";

export interface DefenseParams {
  topic: string;
  dialogHistory: { role: "plaintiff" | "defendant"; content: string }[];
  defenseHistory: { role: "user" | "assistant"; content: string }[];
  userRole: "plaintiff" | "defendant";
}

export async function generateDefenseResponse(
  params: DefenseParams,
  apiKey: string
): Promise<string>

export async function generateDraft(
  params: DefenseParams,
  apiKey: string
): Promise<string>
```

- `generateDefenseResponse`: ヒアリング応答を生成。最新ユーザーメッセージを含む会話履歴全体を multi-turn 形式で渡す。
- `generateDraft`: 回答案（200文字以内の発言文）を生成。

---

### 変更: `app/case/[id]/page.tsx`

#### 追加する state

```ts
const [activeView, setActiveView] = useState<"dialog" | "defense">("dialog");
const [defenseMessages, setDefenseMessages] = useState<DefenseMessage[]>([]);
const [defenseInput, setDefenseInput] = useState("");
const [defenseLoading, setDefenseLoading] = useState(false);
const [draftText, setDraftText] = useState<string | null>(null); // null = モーダル非表示
const [draftLoading, setDraftLoading] = useState(false);
```

#### 追加する処理関数

- `fetchDefenseMessages()`: GET `/api/cases/[id]/defense` で履歴取得。マウント時・ログイン確認後に1回呼び出す。
- `handleSendDefense(e)`: POST `/api/cases/[id]/defense`。レスポンスで `defenseMessages` を更新。
- `handleGenerateDraft()`: POST `/api/cases/[id]/defense/draft`。レスポンスを `draftText` にセット。
- `handleSubmitDraft()`: `argumentText` に `draftText` をセットし、`handleSubmitArgument` を呼び出す。完了後 `activeView` を `"dialog"` に切り替え、`draftText` を `null` にリセット。

#### ビュー切り替えタブ

弁護人AIチャットは `myRole` が `"plaintiff"` または `"defendant"` の場合のみ表示する（認証済み参加者限定）。ゲスト被告には表示しない。

ゲスト判定方法: `caseData.callerRole` が `"plaintiff"` または `"defendant"` かつ、`caseData.defendantId` が `null` でないか `myRole === "plaintiff"` の場合に表示。ただし実装を簡潔にするため、**弁護人AIビューへの切り替えボタンは、`/api/cases/[id]/defense` の GET が 401/403 を返した場合に非表示にする**。

ビュー切り替えタブはページ上部（ヘッダー直下・PlayerChip 行の上）に配置する。

```tsx
{myRole && (
  <div className="max-w-2xl mx-auto w-full px-4 pt-3 flex gap-2">
    <button
      onClick={() => setActiveView("dialog")}
      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
        activeView === "dialog"
          ? "bg-indigo-100 text-indigo-700"
          : "bg-white text-stone-400 border border-stone-200"
      }`}
    >
      対話チャット
    </button>
    <button
      onClick={() => setActiveView("defense")}
      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
        activeView === "defense"
          ? "bg-teal-100 text-teal-700"
          : "bg-white text-stone-400 border border-stone-200"
      }`}
    >
      弁護人AI
    </button>
  </div>
)}
```

#### 条件付きレンダリング

`activeView === "dialog"` の時は既存の timeline + 入力フォームを表示。
`activeView === "defense"` の時は弁護人AIチャットビューを表示。

既存の対話チャット部分は `activeView === "dialog"` で囲む（DOM から除去ではなく `hidden` クラスで隠すことも可だが、スクロール位置リセット等の副作用を避けるため条件レンダリングを推奨）。

---

### 新規: `app/components/DefenseChat.tsx`

弁護人AIチャットのビュー全体をコンポーネントに分離する。

```tsx
interface DefenseChatProps {
  messages: DefenseMessage[];
  input: string;
  loading: boolean;
  draftLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: (e: { preventDefault(): void }) => void;
  onGenerateDraft: () => void;
}

export default function DefenseChat(props: DefenseChatProps)
```

**レイアウト**:

- メッセージ一覧: ユーザーのメッセージは右寄せ（stone-100背景）、AIのメッセージは左寄せ（teal-50背景）。
- 入力フォーム: 下部固定。textarea + 送信ボタン。
- 「回答案を作成する」ボタン: 入力フォームの上に常時表示。teal 系配色。

---

### 新規: `app/components/DraftModal.tsx`

回答案のモーダルポップアップ。

```tsx
interface DraftModalProps {
  draft: string;
  onSubmit: (finalText: string) => void;
  onCancel: () => void;
}

export default function DraftModal(props: DraftModalProps)
```

**レイアウト**:

- オーバーレイ（bg-black/40） + 中央のカード。
- カードの中: タイトル「回答案」・テキストエリア（初期値 = draft、ユーザーが編集可能）・「送信」「キャンセル」ボタン。
- 「送信」: `onSubmit(editedText)` を呼ぶ。
- 「キャンセル」: `onCancel()` を呼ぶ。

---

## AIプロンプト設計

### 弁護人AIヒアリング（`generateDefenseResponse`）

**モデル**: `claude-haiku-4-5-20251001`
**max_tokens**: 512

**システムプロンプト**:

```
あなたは話し合いの場で{{userRoleLabel}}を支援する弁護人AIです。
あなたの役割は、ユーザーの気持ちや主張をていねいに引き出し、整理することです。

<rules>
- まずユーザーの気持ちをそのまま受け止め、共感を示してから次の質問をする
- 1ターンで聞くのは1つの質問だけ。質問を連打しない
- 詰問したり、正しい・間違いと評価したりしない
- ユーザーが話しやすい、安心できる雰囲気を作る
- 簡潔に話す（200文字以内が目安）
- 相手の発言内容への判断や批評は行わない
</rules>
```

`{{userRoleLabel}}` は「提案者（原告）」または「反対者（被告）」。

**会話履歴の渡し方**:

Anthropic SDK の multi-turn 形式（`messages` 配列）を使う。
ユーザー入力・過去の会話履歴は XML タグで構造分離する。

```ts
const messages = [
  {
    role: "user" as const,
    content: `
<context>
<topic>${topic}</topic>
<dialog_history>
${dialogHistory.map((a, i) => `[${i+1}] ${a.role === userRole ? "あなた" : "相手"}: ${a.content}`).join("\n")}
</dialog_history>
</context>
今回の話し合いのテーマと、これまでの対話を共有しました。よろしくお願いします。
    `.trim(),
  },
  { role: "assistant" as const, content: "はじめまして。今日はどんなことで話し合いをされているのか、少し教えていただけますか？" },
  // 以降は defenseHistory の role: 'user' / 'assistant' を交互に展開
  ...defenseHistory.flatMap((m) => [{ role: m.role as "user" | "assistant", content: m.content }]),
];
```

`defenseHistory` が空の場合、最初のユーザーメッセージが context の後に来るため、初回応答は上記の固定 assistant メッセージは**不要**（context を user として渡した後、新しいユーザーメッセージを最後に追加する形にする）。

実装詳細:

```ts
// defenseHistory には既に保存済みのメッセージ（最新ユーザーメッセージを含む）が入る
const apiMessages: Anthropic.MessageParam[] = [
  {
    role: "user",
    content: buildContextMessage(topic, dialogHistory, userRole),
  },
  ...defenseHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
];

// messages は user で始まり user/assistant が交互になるよう調整
// context message (user) → defenseHistory[0] (user) が連続する場合は
// context をシステムプロンプトに移す or defenseHistory の先頭にダミー assistant を挿入しない
// → 解決策: context は system prompt に含め、messages には defenseHistory のみ渡す
```

**最終的な実装方針**:

コンテキスト（topic・対話履歴）はシステムプロンプトに含める。`messages` には `defenseHistory` をそのまま渡す（`role: 'user' | 'assistant'` を変換するだけ）。

```ts
const systemPrompt = `
あなたは話し合いの場で${userRoleLabel}を支援する弁護人AIです。
あなたの役割は、ユーザーの気持ちや主張をていねいに引き出し、整理することです。

<rules>
- まずユーザーの気持ちをそのまま受け止め、共感を示してから次の質問をする
- 1ターンで聞くのは1つの質問だけ。質問を連打しない
- 詰問したり、正しい・間違いと評価したりしない
- ユーザーが話しやすい、安心できる雰囲気を作る
- 簡潔に話す（200文字以内が目安）
- 相手の発言内容への判断や批評は行わない
</rules>

<case_context>
<topic>${topic}</topic>
<dialog_history>
${dialogHistory.length > 0
  ? dialogHistory.map((a, i) => `[${i+1}] ${a.role === userRole ? "あなた" : "相手"}: ${a.content}`).join("\n")
  : "（まだ発言はありません）"}
</dialog_history>
</case_context>
`.trim();

const apiMessages: Anthropic.MessageParam[] = defenseHistory.map((m) => ({
  role: m.role as "user" | "assistant",
  content: m.content,
}));

const response = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 512,
  system: systemPrompt,
  messages: apiMessages,
});
```

---

### 回答案生成（`generateDraft`）

**モデル**: `claude-haiku-4-5-20251001`
**max_tokens**: 256

**プロンプト**:

```
あなたは${userRoleLabel}のために、次のターンで相手に伝える発言文を作成する弁護人AIです。

<case_context>
<topic>${topic}</topic>
<dialog_history>
${dialogHistory.map((a, i) => `[${i+1}] ${a.role === userRole ? "あなた" : "相手"}: ${a.content}`).join("\n")}
</dialog_history>
</case_context>

<defense_chat>
${defenseHistory.map((m) => `${m.role === "user" ? "あなた" : "弁護人AI"}: ${m.content}`).join("\n")}
</defense_chat>

上記の弁護人AIとの対話を踏まえ、次のターンで相手に伝える発言文を200文字以内の日本語で作成してください。
以下の点に気をつけてください:
- 感情的にならず、冷静かつ建設的な表現にする
- あなたの主張と気持ちが伝わる内容にする
- 発言文のみを出力する（前置きや説明は不要）
```

---

## セキュリティ設計

- **RLS**: `defense_messages` は `user_id = auth.uid()` でのみ SELECT・INSERT 可。相手ユーザーからは不可視。
- **APIルートでの本人確認**: セッションから取得した `user.id` がケースの `plaintiff_id` または `defendant_id` と一致する場合のみ処理。サーバーサイドで確認し、RLS に依存しない。
- **プロンプトインジェクション対策**: topic・発言内容・会話履歴を XML タグで囲む。
- **APIキー不在**: `api_key_encrypted` がない場合は 503 ではなく 500 を返す（設定エラー扱い）。実際のエラーログに残す。
- **ゲスト排除**: 弁護人AI機能は `auth.getUser()` が成功した認証済みユーザーのみ利用可能。ゲスト被告（cookie による参加者）は 401 を返す。

---

## 実装順序

依存関係を考慮した推奨実装順序は以下の通り。

### Step 1: DB マイグレーション

`supabase/migrations/20260525000000_create_defense_messages.sql` を作成し、`supabase db push` を実行。

### Step 2: 型定義追加

`lib/types.ts` に `DefenseMessage` インターフェースを追加。

### Step 3: AI ロジック実装

`lib/defense.ts` を新規作成。`generateDefenseResponse` と `generateDraft` を実装。この段階では API ルートに依存しないため独立してテスト可能。

### Step 4: API ルート実装

以下の順で実装する:

1. `app/api/cases/[id]/defense/route.ts`（GET・POST）
2. `app/api/cases/[id]/defense/draft/route.ts`（POST）

### Step 5: UIコンポーネント実装

1. `app/components/DefenseChat.tsx` — チャットビューコンポーネント
2. `app/components/DraftModal.tsx` — 回答案モーダルコンポーネント

### Step 6: ケースページ改修

`app/case/[id]/page.tsx` にタブ切り替えロジック・state・弁護人AI関連ハンドラを追加し、`DefenseChat` と `DraftModal` を組み込む。

---

## 制約・スコープ外

- 相手ユーザーの弁護人AI会話履歴への参照（RLSにより不可）
- 弁護人AIによる自動ヒアリング開始（ユーザーが話しかけるまでAIは動かない）
- 回答案の複数候補生成
- 会話履歴のリセット機能
- ゲスト被告への弁護人AI提供（`auth.uid()` がないため除外）
