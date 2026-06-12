import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { buildCaseResponse } from "@/lib/case-response";
import { isUuid } from "@/lib/text-utils";
import { resolveClosingGreeting, DEFAULT_CLOSING_GREETING } from "@/lib/greetings";

type Actor = "plaintiff" | "defendant" | "guest";

async function determineActor(
  req: NextRequest,
  caseId: string,
  plaintiffId: string,
  defendantId: string | null,
  defendantGuestName: string | null
): Promise<Actor | null> {
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (user.id === plaintiffId) return "plaintiff";
      if (defendantId && user.id === defendantId) return "defendant";
    }
  } catch (err) {
    console.error("[end-proposal] createSessionClient failed:", err);
  }

  if (defendantGuestName) {
    const cookieToken = req.cookies.get(`guest_defendant_${caseId}`)?.value;
    if (cookieToken && (await verifyGuestToken(caseId, cookieToken))) {
      return "guest";
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: c } = await admin
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });

  const actor = await determineActor(
    req,
    id,
    c.plaintiff_id,
    c.defendant_id,
    c.defendant_guest_name
  );
  if (!actor) {
    return NextResponse.json({ error: "このケースを操作する権限がありません" }, { status: 403 });
  }

  // 終了提案を受け付けるのは argument フェーズのみ
  if (c.phase !== "argument") {
    return NextResponse.json(
      { error: "現在のフェーズでは終了を提案できません" },
      { status: 409 }
    );
  }

  const current: string | null = c.end_proposed_by ?? null;

  // 提案なし → 自分が提案
  if (current === null) {
    const { error: updateError } = await admin
      .from("cases")
      .update({ end_proposed_by: actor, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("end_proposed_by", null);
    if (updateError) {
      return NextResponse.json({ error: "提案の保存に失敗しました" }, { status: 500 });
    }
    const caseData = await buildCaseResponse(admin, id);
    return NextResponse.json(caseData);
  }

  // 自分が提案中 → 撤回
  if (current === actor) {
    const { error: updateError } = await admin
      .from("cases")
      .update({ end_proposed_by: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("end_proposed_by", actor);
    if (updateError) {
      return NextResponse.json({ error: "撤回に失敗しました" }, { status: 500 });
    }
    const caseData = await buildCaseResponse(admin, id);
    return NextResponse.json(caseData);
  }

  // 相手が提案中 → 同意 → 終了挨拶を投入してから judging へ
  await insertClosingGreetings(admin, c);
  const { error: judgingError } = await admin
    .from("cases")
    .update({
      phase: "judging",
      end_proposed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (judgingError) {
    return NextResponse.json({ error: "判決フェーズへの遷移に失敗しました" }, { status: 500 });
  }
  const caseData = await buildCaseResponse(admin, id);
  return NextResponse.json(caseData);
}

type AdminClient = ReturnType<typeof createAdminClient>;

interface CaseRow {
  id: string;
  plaintiff_id: string;
  defendant_id: string | null;
}

async function insertClosingGreetings(admin: AdminClient, c: CaseRow) {
  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("closing_greeting")
    .eq("id", c.plaintiff_id)
    .single();
  const plaintiffClosing = resolveClosingGreeting(plaintiffProfile?.closing_greeting ?? null);

  let defendantClosing = DEFAULT_CLOSING_GREETING;
  if (c.defendant_id) {
    const { data: defendantProfile } = await admin
      .from("profiles")
      .select("closing_greeting")
      .eq("id", c.defendant_id)
      .single();
    defendantClosing = resolveClosingGreeting(defendantProfile?.closing_greeting ?? null);
  }

  await admin.from("arguments").insert([
    {
      case_id: c.id,
      role: "plaintiff",
      phase: "closing",
      round: 0,
      content: plaintiffClosing,
      is_greeting: true,
    },
    {
      case_id: c.id,
      role: "defendant",
      phase: "closing",
      round: 0,
      content: defendantClosing,
      is_greeting: true,
    },
  ]);
}

