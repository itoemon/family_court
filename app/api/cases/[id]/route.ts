import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { generateGuestToken, verifyGuestToken } from "@/lib/guest-token";
import { JoinCaseRequest } from "@/lib/types";

async function buildCaseResponse(admin: ReturnType<typeof createAdminClient>, caseId: string) {
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
    const { data: d } = await admin.from("profiles").select("display_name").eq("id", c.defendant_id).single();
    defendant = { name: d?.display_name ?? "反対者", joinedAt: c.updated_at };
  } else if (c.defendant_guest_name) {
    defendant = { name: c.defendant_guest_name, joinedAt: c.updated_at };
  }

  return {
    ...c,
    defendantId: c.defendant_id ?? null,
    plaintiff: { name: plaintiff?.display_name ?? "提案者", joinedAt: c.created_at },
    defendant,
    arguments: args ?? [],
    verdict: verdict ?? null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();
  const caseData = await buildCaseResponse(admin, id);
  if (!caseData) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });

  let callerRole: "plaintiff" | "defendant" | "observer" = "observer";
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      if (user.id === caseData.plaintiff_id) {
        callerRole = "plaintiff";
      } else if (caseData.defendant_id && user.id === caseData.defendant_id) {
        callerRole = "defendant";
      }
    } else if (caseData.defendant_guest_name) {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && verifyGuestToken(id, cookieToken)) {
        callerRole = "defendant";
      }
    }
  } catch (err) {
    console.error("callerRole determination failed:", err);
    return NextResponse.json({ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }, { status: 500 });
  }

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
    return NextResponse.json({ ...caseData, defendantName: profile?.display_name });
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
    return NextResponse.json({ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }, { status: 500 });
  }
  const guestResponse = NextResponse.json(await buildCaseResponse(admin, id));
  guestResponse.cookies.set(`guest_defendant_${id}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/cases/${id}`,
    maxAge: 60 * 60 * 24 * 7,
  });
  return guestResponse;
}
