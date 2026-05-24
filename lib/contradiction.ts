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

  const text =
    message.content[0].type === "text" ? message.content[0].text.trim() : "なし";
  return text === "なし" ? null : text;
}
