import Anthropic from "@anthropic-ai/sdk";
import { Role, JudgeTrigger } from "./types";

interface JudgeParams {
  trigger: JudgeTrigger;
  topic: string;
  plaintiffName: string;
  defendantName: string;
  lastSpeakerRole?: Role;
}

export async function generateJudgeMessage(
  params: JudgeParams,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(params);

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].type === "text" ? message.content[0].text : "";
}

function buildPrompt(params: JudgeParams): string {
  const { trigger, topic, plaintiffName, defendantName, lastSpeakerRole } = params;

  if (trigger === "opening") {
    return `あなたは公正な裁判官です。以下の話し合いの開廷宣言を行ってください。

議題: ${topic}
提案者（原告）: ${plaintiffName}
反対者（被告）: ${defendantName}

威厳があり中立的な言葉で、1〜2文で開廷を宣言してください。前置きや余分な説明なしで、裁判官の言葉のみを出力してください。`;
  }

  if (trigger === "closing") {
    return `あなたは公正な裁判官です。以下の話し合いの閉廷と審議入りを告げてください。

議題: ${topic}

威厳があり中立的な言葉で、1〜2文で閉廷を宣言してください。前置きや余分な説明なしで、裁判官の言葉のみを出力してください。`;
  }

  // trigger === "turn"
  const lastSpeakerName = lastSpeakerRole === "plaintiff" ? plaintiffName : defendantName;
  const lastSpeakerLabel = lastSpeakerRole === "plaintiff" ? "提案者（原告）" : "反対者（被告）";
  const nextSpeakerName = lastSpeakerRole === "plaintiff" ? defendantName : plaintiffName;
  const nextSpeakerLabel = lastSpeakerRole === "plaintiff" ? "反対者（被告）" : "提案者（原告）";

  return `あなたは公正な裁判官です。次のターンへの進行コメントをしてください。

議題: ${topic}
前の発言者: ${lastSpeakerLabel} ${lastSpeakerName}
次の発言者: ${nextSpeakerLabel} ${nextSpeakerName}

次の発言者を促す短いコメントを1〜2文で述べてください。発言内容への評価や介入は禁止です。前置きや余分な説明なしで、裁判官の言葉のみを出力してください。`;
}
