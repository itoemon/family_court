import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requestVerdict } from "@/lib/claude";
import { resolveCaseAiKey } from "@/lib/case-ai-key";
import { Case } from "@/lib/types";
import { isUuid } from "@/lib/text-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.phase !== "judging") {
    return NextResponse.json({ error: "まだ判決を下せるフェーズではありません" }, { status: 409 });
  }

  // 原告 profile を取得し、ケースの課金モードに応じて AI 実行キーを解決。
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, api_key_encrypted")
    .eq("id", c.plaintiff_id)
    .single();

  const keyResult = resolveCaseAiKey(c, profile);
  if (!keyResult.ok) {
    return NextResponse.json({ error: keyResult.error }, { status: keyResult.status });
  }
  const apiKey = keyResult.apiKey;

  const { data: args } = await admin.from("arguments").select("*").eq("case_id", id).order("created_at");

  let defendant = null;
  if (c.defendant_id) {
    const { data: d } = await admin.from("profiles").select("display_name").eq("id", c.defendant_id).single();
    defendant = { name: d?.display_name ?? "反対者", joinedAt: c.updated_at };
  } else if (c.defendant_guest_name) {
    defendant = { name: c.defendant_guest_name, joinedAt: c.updated_at };
  }

  const caseForClaude: Case = {
    id: c.id,
    topic: c.topic,
    plaintiff: { name: profile?.display_name ?? "提案者", joinedAt: c.created_at },
    defendant,
    arguments: (args ?? []).map((a) => ({
      id: a.id,
      role: a.role,
      phase: a.phase,
      round: a.round,
      content: a.content,
      isGreeting: a.is_greeting ?? false,
      createdAt: a.created_at,
    })),
    judgeMessages: [],
    contradictionWarnings: [],
    phase: c.phase,
    currentTurn: c.current_turn,
    round: c.round,
    maxRounds: c.max_rounds,
    endProposedBy: c.end_proposed_by ?? null,
    extensionVotePlaintiff: c.extension_vote_plaintiff ?? null,
    extensionVoteDefendant: c.extension_vote_defendant ?? null,
    usesServiceKey: c.uses_service_key ?? false,
    verdict: null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };

  const verdict = await requestVerdict(caseForClaude, apiKey);

  await admin.from("verdicts").insert({
    case_id: id,
    winner: verdict.winner,
    summary: verdict.summary,
    reasoning: verdict.reasoning,
    plaintiff_score: verdict.plaintiffScore,
    defendant_score: verdict.defendantScore,
  });

  await admin.from("cases").update({ phase: "verdict", updated_at: new Date().toISOString() }).eq("id", id);

  return NextResponse.json({ phase: "verdict", verdict });
}
