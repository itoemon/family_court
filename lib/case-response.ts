import { createAdminClient } from "@/lib/supabase/server";

export async function buildCaseResponse(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string
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

  return {
    id: c.id,
    topic: c.topic,
    phase: c.phase,
    round: c.round,
    currentTurn: c.current_turn,
    maxRounds: c.max_rounds,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    defendantId: c.defendant_id ?? null,
    plaintiff: { name: plaintiff?.display_name ?? "提案者", joinedAt: c.created_at },
    defendant,
    arguments: args ?? [],
    verdict: verdict ?? null,
  };
}
