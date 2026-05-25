import { createAdminClient } from "@/lib/supabase/server";
import { ContradictionWarning, JudgeTrigger } from "@/lib/types";

export async function buildCaseResponse(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  userId?: string
) {
  const { data: c } = await admin.from("cases").select("*").eq("id", caseId).single();
  if (!c) return null;

  const { data: args } = await admin
    .from("arguments")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at");

  const { data: verdict } = await admin
    .from("verdicts")
    .select("*")
    .eq("case_id", caseId)
    .single();

  const { data: judgeMsgs } = await admin
    .from("judge_messages")
    .select("id, content, trigger_type, created_at")
    .eq("case_id", caseId)
    .order("created_at");

  const { data: plaintiff } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", c.plaintiff_id)
    .single();

  let defendant = null;
  if (c.defendant_id) {
    const { data: d } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", c.defendant_id)
      .single();
    defendant = { name: d?.display_name ?? "反対者", joinedAt: c.updated_at };
  } else if (c.defendant_guest_name) {
    defendant = { name: c.defendant_guest_name, joinedAt: c.updated_at };
  }

  let contradictionWarnings: ContradictionWarning[] = [];
  if (userId) {
    const { data: warnings } = await admin
      .from("contradiction_warnings")
      .select("id, argument_id, message, created_at")
      .eq("case_id", caseId)
      .eq("user_id", userId)
      .order("created_at")
      .limit(100);
    contradictionWarnings = (warnings ?? []).map((w) => ({
      id: w.id,
      argumentId: w.argument_id,
      message: w.message,
      createdAt: w.created_at,
    }));
  }

  return {
    id: c.id,
    topic: c.topic,
    phase: c.phase,
    round: c.round,
    currentTurn: c.current_turn,
    maxRounds: c.max_rounds,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    plaintiff: { name: plaintiff?.display_name ?? "提案者", joinedAt: c.created_at },
    defendant,
    arguments: (args ?? []).map((a) => ({
      id: a.id,
      role: a.role,
      phase: a.phase,
      round: a.round,
      content: a.content,
      createdAt: a.created_at,
    })),
    judgeMessages: (judgeMsgs ?? []).map((jm) => ({
      id: jm.id,
      content: jm.content,
      triggerType: jm.trigger_type as JudgeTrigger,
      createdAt: jm.created_at,
    })),
    contradictionWarnings,
    verdict: verdict ?? null,
  };
}
