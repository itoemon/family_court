import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { generateGuestToken, verifyGuestToken } from "@/lib/guest-token";
import { JoinCaseRequest } from "@/lib/types";
import { buildCaseResponse } from "@/lib/case-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: rawCase } = await admin
    .from("cases")
    .select("plaintiff_id, defendant_id, defendant_guest_name")
    .eq("id", id)
    .single();
  if (!rawCase) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });

  let callerRole: "plaintiff" | "defendant" | "observer" = "observer";
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      if (user.id === rawCase.plaintiff_id) {
        callerRole = "plaintiff";
      } else if (rawCase.defendant_id && user.id === rawCase.defendant_id) {
        callerRole = "defendant";
      }
    } else if (rawCase.defendant_guest_name) {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && verifyGuestToken(id, cookieToken)) {
        callerRole = "defendant";
      }
    }
  } catch (err) {
    console.error("callerRole determination failed:", err);
    return NextResponse.json(
      { error: "サーバー設定エラーが発生しました。管理者に連絡してください。" },
      { status: 500 }
    );
  }

  const caseData = await buildCaseResponse(admin, id);
  if (!caseData) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  return NextResponse.json({ ...caseData, callerRole });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.defendant_id || c.defendant_guest_name) {
    return NextResponse.json({ error: "既に被告が参加しています" }, { status: 409 });
  }

  const body: JoinCaseRequest & { asGuest?: boolean } = await req.json();

  // アカウントログインで参加
  if (!body.asGuest) {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    if (user.id === c.plaintiff_id) {
      return NextResponse.json({ error: "自分自身とは話し合いできません" }, { status: 409 });
    }
    await admin.from("cases").update({ defendant_id: user.id, phase: "opening" }).eq("id", id);
    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).single();
    const caseData = await buildCaseResponse(admin, id);
    return NextResponse.json({ ...caseData, defendantName: profile?.display_name, callerRole: "defendant" });
  }

  // ゲストで参加
  if (!body.defendantName?.trim()) {
    return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
  }
  await admin.from("cases").update({ defendant_guest_name: body.defendantName.trim(), phase: "opening" }).eq("id", id);
  let token: string;
  try {
    token = generateGuestToken(id);
  } catch (err) {
    console.error("generateGuestToken failed:", err);
    return NextResponse.json(
      { error: "サーバー設定エラーが発生しました。管理者に連絡してください。" },
      { status: 500 }
    );
  }
  const guestResponse = NextResponse.json({ ...(await buildCaseResponse(admin, id)), callerRole: "defendant" });
  guestResponse.cookies.set(`guest_defendant_${id}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/cases/${id}`,
    maxAge: 60 * 60 * 24 * 7,
  });
  return guestResponse;
}
