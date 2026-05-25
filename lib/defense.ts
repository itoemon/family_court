import Anthropic from "@anthropic-ai/sdk";
import { truncate, escapeXml } from "@/lib/text-utils";

export interface DefenseParams {
  topic: string;
  dialogHistory: { role: "plaintiff" | "defendant"; content: string }[];
  defenseHistory: { role: "user" | "assistant"; content: string }[];
  userRole: "plaintiff" | "defendant";
}

function getUserRoleLabel(userRole: "plaintiff" | "defendant"): string {
  return userRole === "plaintiff" ? "提案者（原告）" : "反対者（被告）";
}

export async function generateDefenseResponse(
  params: DefenseParams,
  apiKey: string
): Promise<string> {
  const { topic, dialogHistory, defenseHistory, userRole } = params;
  const client = new Anthropic({ apiKey });
  const userRoleLabel = getUserRoleLabel(userRole);

  const systemPrompt = `あなたは話し合いの場で${userRoleLabel}を支援する弁護人AIです。
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
<topic>${escapeXml(topic)}</topic>
<dialog_history>
${dialogHistory.length > 0
  ? dialogHistory.map((a, i) => `[${i + 1}] ${a.role === userRole ? "あなた" : "相手"}: ${escapeXml(truncate(a.content, 500))}`).join("\n")
  : "（まだ発言はありません）"}
</dialog_history>
</case_context>`.trim();

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

  return response.content[0].type === "text" ? response.content[0].text : "";
}

export async function generateDraft(
  params: DefenseParams,
  apiKey: string
): Promise<string> {
  const { topic, dialogHistory, defenseHistory, userRole } = params;
  const client = new Anthropic({ apiKey });
  const userRoleLabel = getUserRoleLabel(userRole);

  const prompt = `あなたは${userRoleLabel}のために、次のターンで相手に伝える発言文を作成する弁護人AIです。

<case_context>
<topic>${escapeXml(topic)}</topic>
<dialog_history>
${dialogHistory.length > 0
  ? dialogHistory.map((a, i) => `[${i + 1}] ${a.role === userRole ? "あなた" : "相手"}: ${escapeXml(truncate(a.content, 500))}`).join("\n")
  : "（まだ発言はありません）"}
</dialog_history>
</case_context>

<defense_chat>
${defenseHistory.map((m) => `${m.role === "user" ? "あなた" : "弁護人AI"}: ${escapeXml(truncate(m.content, 500))}`).join("\n")}
</defense_chat>

上記の弁護人AIとの対話を踏まえ、次のターンで相手に伝える発言文を200文字以内の日本語で作成してください。
以下の点に気をつけてください:
- 感情的にならず、冷静かつ建設的な表現にする
- あなたの主張と気持ちが伝わる内容にする
- 発言文のみを出力する（前置きや説明は不要）`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
