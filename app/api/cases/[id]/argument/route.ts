import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { AddArgumentRequest, Role } from "@/lib/types";
import { buildCaseResponse } from "@/lib/case-response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (["waiting", "judging", "verdict"].includes(c.phase)) {
    return NextResponse.json({ error: "現在は発言できないフェーズです" }, { status: 409 });
  }

  // 呼び出し者の身元確認とロール導出
  let callerRole: Role | null = null;
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      if (user.id === c.plaintiff_id) {
        callerRole = "plaintiff";
      } else if (c.defendant_id && user.id === c.defendant_id) {
        callerRole = "defendant";
      }
    }

    if (!callerRole && c.defendant_guest_name) {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && verifyGuestToken(id, cookieToken)) {
        callerRole = "defendant";
      }
    }
  } catch (err) {
    console.error("callerRole determination failed:", err);
    return NextResponse.json({ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }, { status: 500 });
  }

  if (!callerRole) {
    return NextResponse.json({ error: "このケースへの発言権限がありません" }, { status: 403 });
  }

  const body: AddArgumentRequest = await req.json();
  if (callerRole !== c.current_turn) {
    return NextResponse.json({ error: "あなたのターンではありません" }, { status: 409 });
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "発言内容は必須です" }, { status: 400 });
  }
  if (body.content.trim().length > 500) {
    return NextResponse.json({ error: "発言は500文字以内で入力してください" }, { status: 400 });
  }

  await admin.from("arguments").insert({
    case_id: id,
    role: callerRole,
    phase: c.phase,
    round: c.round,
    content: body.content.trim(),
  });

  // ターン交代・フェーズ進行
  let nextTurn = c.current_turn;
  let nextPhase = c.phase;
  let nextRound = c.round;

  if (c.current_turn === "plaintiff") {
    nextTurn = "defendant";
  } else {
    nextTurn = "plaintiff";
    nextRound += 1;

    if (c.phase === "opening") {
      nextPhase = "argument";
      nextRound = 1;
    } else if (c.phase === "argument" && nextRound > c.max_rounds) {
      nextPhase = "closing";
      nextRound = 1;
    } else if (c.phase === "closing") {
      nextPhase = "judging";
    }
  }

  await admin.from("cases").update({
    current_turn: nextTurn,
    phase: nextPhase,
    round: nextRound,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  const caseData = await buildCaseResponse(admin, id);
  return NextResponse.json(caseData);
}
