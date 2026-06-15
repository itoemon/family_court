# アーキ → ビルド 引き継ぎメモ（BUG-005）

このメモは `docs/knowledge/design.md` 末尾の `## BUG-005 閉廷アナウンス条件の修正` セクションと併読すること。
矛盾があれば `task.md` → `design.md` → 本メモの順で優先する。

---

## 設計上の主要判断と理由

### 1. AI 閉廷宣告と closing greeting を「1 つのヘルパーに集約しない」

- **判断**: `lib/case-closing.ts:insertClosingJudgeMessage` は `judge_messages` テーブルのみを担当し、`arguments` テーブル（closing greeting）には一切触れない。closing greeting 側は既存 `lib/greetings.ts:insertClosingGreetingsForCase` をそのまま流用する。
- **理由**: task.md「テーブル境界の整理」セクションで「両者を 1 関数に集約しない」がダイチ確認済みの確定事項。挿入順序（greeting → AI）は呼び出し側（`end-proposal` / `extension-vote`）の文の順序で担保する。
- **トレードオフ**: 2 関数を順に呼ぶことになるため、呼び出し側にコード重複が出る（2 経路）。ただし共通化対象が小さいため過度な抽象化を避ける判断（CLAUDE.md / AGENTS.md 方針）。
- **実装上の注意**: ヘルパー内に「内部で `insertClosingGreetingsForCase` を呼んで一括化する」誘惑が出ても拒否すること。テーブル境界の侵食が始まる起点になる。

### 2. AI 生成 / INSERT 失敗時は phase 遷移をロールバックしない

- **判断**: `insertClosingJudgeMessage` 内の `generateJudgeMessage` 失敗・`judge_messages` INSERT 失敗とも `console.error` でログのみとし、上位に例外を伝播させない。`phase=judging` 遷移自体は維持して判決生成フローに進める。
- **理由**: closing greeting だけ挿入されて AI 閉廷宣告が欠落する状態でも、ユーザー体験上は判決画面に進める方が良い（task.md 確定事項）。AI 生成は外部依存のため、失敗で UX を巻き戻すと判決画面に到達不能になるリスクが大きい。
- **トレードオフ**: 「閉廷宣告だけが欠落した不整合状態」が DB に残る。verdict 画面表示時に判決理由文だけ表示されて AI 閉廷文がない見た目になるが、greeting 行は表示されるため会話として最低限成立する。

### 3. `lastSpeakerRole` は `arguments` 由来で導出する

- **判断**: `end-proposal` / `extension-vote` で「直前の発言者」が分からないため、`arguments` から `is_greeting=false` で最新 row を SELECT して `role` を取得する。クエリ失敗 / 0 件は `"plaintiff"` を fallback。
- **理由**: closing プロンプトは `lastSpeakerRole` を実際には参照していないが、`generateJudgeMessage` の signature 上必須引数（`JudgeParams` interface 由来）。型 / 既存契約を壊さず、かつ将来 closing プロンプトを `lastSpeakerRole` 依存に拡張可能な余地を残す。
- **代替案として却下**: `cases.current_turn` を反転させて代用する案は、current_turn が「次に話す予定の人」を示す前提に依存する。closing greeting INSERT 前の current_turn の値がフェーズ遷移前後で何を指しているか曖昧なケースが残るため、accuracy 優先で arguments 由来とする。

### 4. closing 生成削除は `argument/route.ts` の 2 箇所のみ

- **判断**: `argument/route.ts:132` の warn メッセージと `argument/route.ts:146` の `triggerType` 三項演算子を削除し、`turn` 固定にする。これで `judge_messages` への `trigger_type='closing'` INSERT パスが当ファイルから消える。
- **理由**: task.md L34-40 に明示。`extension_voting` 遷移後の turn 生成も発生させない方針なので、`triggerType` を `"turn"` 固定にしたあと「`nextPhase === "extension_voting"` なら try ブロック全体をスキップ」する分岐を残すかは実装側の判断に委ねるが、`argument` フェーズを離れたあとに turn コメントが出る意味も薄いため、`if (nextPhase !== "argument") return` で turn 生成自体もスキップするのが筋。
- **重要**: `nextPhase === "extension_voting"` 遷移時に **turn も含めて** `judge_messages` INSERT が起きないことを確認するテストが必要（task.md「テスト観点」#1, #5）。

### 5. 共通ヘルパーは `lib/case-closing.ts` 単独ファイルとして新設

- **判断**: 既存 `lib/judge.ts` や `lib/greetings.ts` に押し込まず、`lib/case-closing.ts` を新規ファイルとして作る。
- **理由**: 責務境界が明確（「AI 閉廷宣告の `judge_messages` 挿入」のみ）。`lib/judge.ts` は AI プロンプト構築と Claude API 呼び出しの責務、`lib/greetings.ts` は固定挨拶と `arguments` テーブルの責務に既に分かれており、本ヘルパーは「両者を順に組み立てる呼び出し側コード」の重複部分を吸収する目的のため、別ファイルが筋。
- **`lib/case-closing.ts` の責務外**: `arguments` SELECT / INSERT、固定挨拶文字列、phase 遷移、認可判定。これらを書きそうになったら設計のどこかが間違っているサイン。

---

## 実装の順序（推奨）

1. **新規ヘルパー作成**: `lib/case-closing.ts` を新規作成。`insertClosingJudgeMessage(admin, plaintiffApiKey, { caseId, topic, plaintiffName, defendantName, lastSpeakerRole }): Promise<void>` を実装。
2. **argument/route.ts 修正**: L132 の warn メッセージから `closing` 文字列を削除して `turn` 固定。L146 の三項演算子を削除して `triggerType = "turn"` 固定。さらに `nextPhase === "extension_voting"` 時は try ブロック全体をスキップ（早期 return）して turn 生成も抑止する。
3. **end-proposal/route.ts 修正**: L127 の `insertClosingGreetingsForCase` 呼び出し成功直後（`greetingError == null` 経路、L148 直後）に、AI 閉廷宣告呼び出しブロックを追加。
4. **extension-vote/route.ts 修正**: 両者 finish 経路の `insertClosingGreetingsForCase` 呼び出し成功直後（L172-175 周辺）に、AI 閉廷宣告呼び出しブロックを追加。
5. **動作確認**（ローカル）:
   - 新規ケース → 3 ラウンド完了 → `phase=extension_voting` 遷移時に `judge_messages.trigger_type='closing'` が **挿入されていない** ことを SQL で確認
   - そのまま延長投票で両者 finish → `judge_messages.trigger_type='closing'` が 1 件挿入されることを確認
   - 別ケースで早期 end-proposal 両者合意 → 同じく 1 件挿入されることを確認
6. **テスタへ引き継ぐ前に**: `grep -rn "trigger_type.*closing" app/ lib/` を打って、`closing` の INSERT 箇所が `lib/case-closing.ts` の 1 箇所のみであることを確認（オーディ観点 task.md L133）。

---

## ヘルパー実装ドラフト

```typescript
// lib/case-closing.ts
import type { createAdminClient } from "@/lib/supabase/server";
import { generateJudgeMessage } from "@/lib/judge";
import type { Role } from "@/lib/types";

type AdminClient = ReturnType<typeof createAdminClient>;

interface InsertClosingJudgeMessageArgs {
  caseId: string;
  topic: string;
  plaintiffName: string;
  defendantName: string;
  lastSpeakerRole: Role;
}

// phase=judging 遷移成功後に呼ばれる前提。
// 失敗してもログのみで例外は伝播させない（呼び出し側は判決生成フローに進む）。
export async function insertClosingJudgeMessage(
  admin: AdminClient,
  plaintiffApiKey: string | null,
  args: InsertClosingJudgeMessageArgs
): Promise<void> {
  if (!plaintiffApiKey) {
    console.warn(`[judge] closing: plaintiff has no api_key_encrypted (case=${args.caseId})`);
    return;
  }

  let content = "";
  try {
    content = await generateJudgeMessage(
      {
        trigger: "closing",
        topic: args.topic,
        plaintiffName: args.plaintiffName,
        defendantName: args.defendantName,
        lastSpeakerRole: args.lastSpeakerRole,
      },
      plaintiffApiKey
    );
  } catch (err) {
    console.error("[judge] closing generation failed:", err);
    return;
  }

  if (!content) {
    // 既存パターン（PR #14 D-5）: 空文字 INSERT ガード
    return;
  }

  try {
    const { error } = await admin
      .from("judge_messages")
      .insert({ case_id: args.caseId, content, trigger_type: "closing" });
    if (error) {
      console.error("[judge] closing insert failed:", error);
    }
  } catch (err) {
    console.error("[judge] closing insert threw:", err);
  }
}
```

---

## 呼び出し側ドラフト（end-proposal / extension-vote 共通パターン）

`insertClosingGreetingsForCase` 成功直後に挿入する。

```typescript
// 1) plaintiff profile（display_name + api_key_encrypted）取得
const { data: plaintiffProfile } = await admin
  .from("profiles")
  .select("display_name, api_key_encrypted")
  .eq("id", caseRow.plaintiff_id)
  .single();
const plaintiffApiKey = plaintiffProfile?.api_key_encrypted
  ? decryptApiKey(plaintiffProfile.api_key_encrypted)
  : null;

// 2) defendant 名解決（既存 argument/route.ts L134-144 と同じパターン）
let defendantName = "反対者";
if (caseRow.defendant_id) {
  const { data: defProfile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", caseRow.defendant_id)
    .single();
  defendantName = defProfile?.display_name ?? "反対者";
} else if (caseRow.defendant_guest_name) {
  defendantName = caseRow.defendant_guest_name;
}

// 3) lastSpeakerRole: arguments テーブルから直前発言者を取得
const { data: lastArg } = await admin
  .from("arguments")
  .select("role")
  .eq("case_id", id)
  .eq("is_greeting", false)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
const lastSpeakerRole: Role = (lastArg?.role as Role) ?? "plaintiff";

// 4) AI 閉廷宣告 INSERT（ヘルパー側でログのみ、例外は伝播しない）
await insertClosingJudgeMessage(admin, plaintiffApiKey, {
  caseId: id,
  topic: caseRow.topic,
  plaintiffName: plaintiffProfile?.display_name ?? "提案者",
  defendantName,
  lastSpeakerRole,
});
```

- `end-proposal` 側では `caseRow = c`（L47-52 で取得済み）。`topic` フィールドを SELECT に含めるよう既存の `select("*")` で取れているはずだが、明示的に確認すること。
- `extension-vote` 側は `refreshed` を使う（票集計直後の row、L101-105）。`refreshed` も `select("*")` なので `topic` を含む。
- 上記ブロックを `end-proposal` / `extension-vote` の 2 箇所で書く。**関数化はしない**（共通化候補は 2 経路のみで、`caseRow` の取得名・参照タイミングが異なるため。CLAUDE.md の過度抽象化禁止に従う）。

---

## リグレッション確認シナリオ（必須）

1. **3 ラウンド自然完了 → 延長投票 continue 選択 → 新ラウンド開始**
   - `judge_messages` に `trigger_type='closing'` が新規挿入されない（SQL で COUNT を取って 0 件であること）
   - 延長後の 4 ラウンド目は `turn` メッセージが従来通り表示される
2. **3 ラウンド自然完了 → 延長投票で両者 finish → `phase=judging`**
   - `arguments` に closing greeting 2 行（`role=plaintiff/defendant`, `phase='closing'`, `round=0`, `is_greeting=true`）
   - `judge_messages` に `trigger_type='closing'` 1 行
   - `arguments` の closing greeting `created_at` が `judge_messages.created_at` より前
3. **早期 end-proposal 両者合意 → `phase=judging`**
   - 上記 #2 と同じ条件
4. **AI 生成失敗時のフォールバック**
   - `profiles.api_key_encrypted` を一時的に NULL にして上記 #2 / #3 を試す
   - `phase=judging` 遷移は成功、closing greeting は挿入される
   - `judge_messages.trigger_type='closing'` は欠落（0 件）
   - サーバログに `[judge] closing: plaintiff has no api_key_encrypted` が出る
5. **`extension_voting` フェーズ中の polling**
   - 3 ラウンド完了 → 延長投票画面で待機 → `judge_messages` を polling で取得し続けても新規 `trigger_type='closing'` レコードが増えない
6. **既存 turn メッセージへの影響なし**
   - 1〜3 ラウンドの各ターン交代時に `trigger_type='turn'` レコードが従来通り挿入される
   - `argument/route.ts` の matrix チェック失敗・rollback 経路は触っていないため挙動不変
7. **BUG-007 / BUG-004 関連 regression**
   - 当該 spec を全件実行して赤化なし

---

## やってはいけないこと

- 既存 `design.md` セクションの削除・短縮（`feedback-design-md` 違反）
- `lib/judge.ts` の closing プロンプト文言・トークン数・モデル指定の変更（スコープ外）
- `lib/greetings.ts:insertClosingGreetingsForCase` のシグネチャ・挙動変更
- `lib/case-closing.ts` 内で `arguments` テーブルや `DEFAULT_CLOSING_GREETING` を参照すること（テーブル境界違反）
- 過去ケースの `judge_messages` レコードへの遡及 UPDATE / DELETE
- `extension_voting` フェーズ中の UI / CaseRoom 側コンポーネントへの変更
- 新規 migration の作成（DB スキーマ変更なし）
- `judge_messages.trigger_type` の値追加 / 変更（既存 3 値 `'opening' / 'turn' / 'closing'` を維持）
- `argument/route.ts` の turn 生成パスの破壊（巻き添えで turn が出なくなっていないかオーディ観点 task.md L128 で必ず確認される）

---

## 未解決事項 / 実装で迷ったら

1. **`nextPhase === "extension_voting"` 時に turn コメントも抑止するか**: 推奨は抑止（try ブロック全体スキップ）。`argument` フェーズを離れたあとに turn コメントが出る意味は薄く、polling 経由でユーザーに不要なメッセージが見える。明示判断不要なら抑止で進める。
2. **`api_key_encrypted` NULL ケースのテレメトリ強化**: 現状 `console.warn` のみ。プロダクション運用で頻発するなら次タスクで `judge_messages` 側に「AI 生成スキップ印」を残すか検討。本タスクではログのみで OK。
3. **「閉廷しました」UI ラベル**: task.md スコープ外明示。CaseRoom 内でこの種のラベルを実装中に発見した場合は backlog に派生タスクとして追加し、本 PR では触らない。
4. **`lastSpeakerRole` の fallback `"plaintiff"`**: 理屈上ありえない経路だが、`generateJudgeMessage` が closing trigger では `lastSpeakerRole` を実際には参照していないため fallback 値は AI 出力に影響しない（プロンプト構築で使われない）。型を満たすためだけの値。
5. **コミット忘れ防止**: `lib/case-closing.ts` は新規ファイルのため `git add` 忘れの典型ケース。コミット前に `git status` で untracked が残っていないことを必ず確認（feedback `commit_check` の運用化対象）。

---

## 関連ドキュメント

- `docs/knowledge/task.md`（最優先）
- `docs/knowledge/design.md` の `## BUG-005 閉廷アナウンス条件の修正` セクション（本メモと併読）
- `docs/knowledge/requirements.md`
- `docs/knowledge/environment.md`
- `docs/decisions/003-db-design.md`（RLS 方針）
- `docs/decisions/004-ai-connection.md`（BYOK 方針）
- `docs/backlog.md` の BUG-005
- `lib/judge.ts:49-54`（変更しない closing プロンプト本体）
- `lib/greetings.ts:83-98`（変更しない `insertClosingGreetingsForCase`）
