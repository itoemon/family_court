import Anthropic from "@anthropic-ai/sdk";
import { Case, Verdict } from "./types";

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    return true;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return false;
    throw error;
  }
}

export async function requestVerdict(c: Case, apiKey: string): Promise<Verdict> {
  // テスト環境 (TEST_MODE=1) では実 Anthropic 呼び出しを避け決定的なモックを返す。
  // 本番で誤設定されてもモックが暴発しないよう production では無視する（generateJudgeMessage と同方針）。
  if (process.env.TEST_MODE === "1" && process.env.NODE_ENV !== "production") {
    return {
      winner: "draw",
      summary: "[TEST] モック判決",
      reasoning: "[TEST] モック判決理由",
      plaintiffScore: 50,
      defendantScore: 50,
      decidedAt: new Date().toISOString(),
    };
  }

  const client = new Anthropic({ apiKey });
  const transcript = c.arguments
    .map((arg) => {
      const roleName = arg.role === "plaintiff" ? `原告（${c.plaintiff?.name}）` : `被告（${c.defendant?.name}）`;
      return `【${roleName} / ${phaseLabel(arg.phase)} 第${arg.round}ラウンド】\n${arg.content}`;
    })
    .join("\n\n");

  const prompt = `あなたは公正な裁判官です。以下の裁判の記録を読み、判決を下してください。

## 議題
${c.topic}

## 当事者
- 原告: ${c.plaintiff?.name}
- 被告: ${c.defendant?.name}

## 口頭弁論の記録
${transcript}

## 判決の形式
以下のJSON形式のみで回答してください（コードブロックなし、余分なテキストなし）:
{
  "winner": "plaintiff" | "defendant" | "draw",
  "summary": "判決要旨（1〜2文）",
  "reasoning": "判決理由（各当事者の主張の評価を含む詳細な説明、400〜600文字）",
  "plaintiffScore": 0〜100の整数（原告の主張の説得力スコア）,
  "defendantScore": 0〜100の整数（被告の主張の説得力スコア）
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  // SEC-003: content が空配列 / 先頭が非 text ブロックでも例外にせずガードする。
  const first = message.content[0];
  const text = first && first.type === "text" ? first.text : "";

  let parsed: Omit<Verdict, "decidedAt">;
  try {
    parsed = normalizeVerdict(JSON.parse(text));
  } catch {
    parsed = {
      winner: "draw",
      summary: "判決の取得に失敗しました。",
      reasoning: text,
      plaintiffScore: 50,
      defendantScore: 50,
    };
  }

  return {
    ...parsed,
    decidedAt: new Date().toISOString(),
  };
}

// SEC-003: モデル出力の検証・クランプ。winner は enum に矯正、スコアは 0–100 の整数に丸める。
function normalizeVerdict(raw: unknown): Omit<Verdict, "decidedAt"> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const winner: Verdict["winner"] =
    o.winner === "plaintiff" || o.winner === "defendant" || o.winner === "draw"
      ? o.winner
      : "draw";
  const clampScore = (n: unknown): number => {
    const v = typeof n === "number" ? n : Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50;
  };
  return {
    winner,
    summary: typeof o.summary === "string" ? o.summary : "",
    reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
    plaintiffScore: clampScore(o.plaintiffScore),
    defendantScore: clampScore(o.defendantScore),
  };
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    opening: "冒頭陳述",
    argument: "主張",
    closing: "最終弁論",
  };
  return labels[phase] ?? phase;
}
