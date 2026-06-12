import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { buildCaseResponse } from "@/lib/case-response";
import { isUuid } from "@/lib/text-utils";
import { insertClosingGreetingsForCase } from "@/lib/greetings";

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

  // 相手が提案中 → 同意 → judging へ
  // 楽観ロックで「相手の提案がまだ生きていて、かつフェーズが argument のまま」を再確認する。
  // 撤回 / 別経路での遷移と競合した場合は更新件数 0 になるので 409 を返す（MEDIUM-003）。
  const { data: judgingUpdated, error: judgingError } = await admin
    .from("cases")
    .update({
      phase: "judging",
      end_proposed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("end_proposed_by", current)
    .eq("phase", "argument")
    .select("id");
  if (judgingError) {
    return NextResponse.json({ error: "判決フェーズへの遷移に失敗しました" }, { status: 500 });
  }
  if (!judgingUpdated || judgingUpdated.length === 0) {
    return NextResponse.json(
      { error: "相手が提案を取り下げたため終了できません" },
      { status: 409 }
    );
  }
  // UPDATE 成功確認後にのみ終了挨拶を INSERT（MEDIUM-001）。
  const { error: greetingError } = await insertClosingGreetingsForCase(admin, {
    caseId: id,
    plaintiffId: c.plaintiff_id,
    defendantId: c.defendant_id,
  });
  if (greetingError) {
    console.error("[end-proposal] closing greeting insert failed:", greetingError);
    return NextResponse.json({ error: "終了挨拶の保存に失敗しました" }, { status: 500 });
  }
  const caseData = await buildCaseResponse(admin, id);
  return NextResponse.json(caseData);
}

