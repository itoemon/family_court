import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { generateGuestToken, verifyGuestToken } from "@/lib/guest-token";
import { JoinCaseRequest } from "@/lib/types";
import { buildCaseResponse } from "@/lib/case-response";
import { generateJudgeMessage } from "@/lib/judge";
import { decryptApiKey } from "@/lib/crypto";
import { isUuid } from "@/lib/text-utils";
import { insertOpeningGreetingsForCase } from "@/lib/greetings";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: rawCase } = await admin
    .from("cases")
    .select("plaintiff_id, defendant_id, defendant_guest_name")
    .eq("id", id)
    .single();
  if (!rawCase) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });

  let callerRole: "plaintiff" | "defendant" | "observer" = "observer";
  let userId: string | undefined;
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      userId = user.id;
      if (user.id === rawCase.plaintiff_id) {
        callerRole = "plaintiff";
      } else if (rawCase.defendant_id && user.id === rawCase.defendant_id) {
        callerRole = "defendant";
      }
    } else if (rawCase.defendant_guest_name) {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && await verifyGuestToken(id, cookieToken)) {
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

  const caseData = await buildCaseResponse(admin, id, userId);
  if (!caseData) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  return NextResponse.json({ ...caseData, callerRole });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.defendant_id || c.defendant_guest_name) {
    return NextResponse.json({ error: "既に被告が参加しています" }, { status: 409 });
  }

  const body: JoinCaseRequest & { asGuest?: boolean } = await req.json();

  // アカウントログインで参加
  if (!body.asGuest) {
    let supabase;
    let user;
    try {
      supabase = await createSessionClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      user = u;
    } catch (err) {
      console.error("createSessionClient failed:", err);
      return NextResponse.json(
        { error: "サーバー設定エラーが発生しました。管理者に連絡してください。" },
        { status: 500 }
      );
    }
    if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    if (user.id === c.plaintiff_id) {
      return NextResponse.json({ error: "自分自身とは話し合いできません" }, { status: 409 });
    }
    // LOW-001: 挨拶 INSERT を先に行い、成功した場合のみ参加 UPDATE に進む。
    // 参加 UPDATE が失敗した場合は挨拶 row を rollback で削除し、再参加可能な状態に戻す。
    const { error: openingGreetingError } = await insertOpeningGreetingsForCase(admin, {
      caseId: id,
      plaintiffId: c.plaintiff_id,
      defendantId: user.id,
    });
    if (openingGreetingError) {
      console.error("[cases PATCH] opening greeting insert failed (auth):", openingGreetingError);
      return NextResponse.json({ error: "開始挨拶の保存に失敗しました" }, { status: 500 });
    }
    const { error: joinError } = await admin
      .from("cases")
      .update({ defendant_id: user.id, phase: "opening" })
      .eq("id", id);
    if (joinError) {
      console.error("[cases PATCH] join update failed (auth):", joinError);
      await admin
        .from("arguments")
        .delete()
        .eq("case_id", id)
        .eq("is_greeting", true)
        .eq("phase", "opening");
      return NextResponse.json({ error: "参加処理に失敗しました" }, { status: 500 });
    }
    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).single();
    try {
      const { data: plaintiffProfile } = await admin
        .from("profiles")
        .select("display_name, api_key_encrypted")
        .eq("id", c.plaintiff_id)
        .single();
      if (!plaintiffProfile?.api_key_encrypted) {
        console.warn(`[judge] opening: plaintiff ${c.plaintiff_id} has no api_key_encrypted`);
      } else {
        const apiKey = decryptApiKey(plaintiffProfile.api_key_encrypted);
        const content = await generateJudgeMessage({
          trigger: "opening",
          topic: c.topic,
          plaintiffName: plaintiffProfile.display_name ?? "提案者",
          defendantName: profile?.display_name ?? "反対者",
        }, apiKey);
        if (content) {
          await admin.from("judge_messages").insert({ case_id: id, content, trigger_type: "opening" });
        }
      }
    } catch (err) {
      console.error("[judge] opening generation failed:", err);
    }
    const caseData = await buildCaseResponse(admin, id);
    if (!caseData) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
    return NextResponse.json({ ...caseData, defendantName: profile?.display_name, callerRole: "defendant" });
  }

  // ゲストで参加
  if (!body.defendantName?.trim()) {
    return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
  }
  if (body.defendantName.trim().length > 50) {
    return NextResponse.json({ error: "名前は50文字以内で入力してください" }, { status: 400 });
  }
  // トークン発行を先に行い、失敗してもケースがロックされないようにする
  let token: string;
  try {
    token = await generateGuestToken(id);
  } catch (err) {
    console.error("generateGuestToken failed:", err);
    return NextResponse.json(
      { error: "サーバー設定エラーが発生しました。管理者に連絡してください。" },
      { status: 500 }
    );
  }
  // LOW-001: 挨拶 INSERT を先に行い、成功した場合のみ参加 UPDATE に進む（ゲスト経路も同様）。
  const { error: openingGreetingError } = await insertOpeningGreetingsForCase(admin, {
    caseId: id,
    plaintiffId: c.plaintiff_id,
    defendantId: null,
  });
  if (openingGreetingError) {
    console.error("[cases PATCH] opening greeting insert failed (guest):", openingGreetingError);
    return NextResponse.json({ error: "開始挨拶の保存に失敗しました" }, { status: 500 });
  }
  const { error: guestJoinError } = await admin
    .from("cases")
    .update({ defendant_guest_name: body.defendantName.trim(), phase: "opening" })
    .eq("id", id);
  if (guestJoinError) {
    console.error("[cases PATCH] join update failed (guest):", guestJoinError);
    await admin
      .from("arguments")
      .delete()
      .eq("case_id", id)
      .eq("is_greeting", true)
      .eq("phase", "opening");
    return NextResponse.json({ error: "参加処理に失敗しました" }, { status: 500 });
  }
  try {
    const { data: plaintiffProfile } = await admin
      .from("profiles")
      .select("display_name, api_key_encrypted")
      .eq("id", c.plaintiff_id)
      .single();
    if (!plaintiffProfile?.api_key_encrypted) {
      console.warn(`[judge] opening: plaintiff ${c.plaintiff_id} has no api_key_encrypted`);
    } else {
      const apiKey = decryptApiKey(plaintiffProfile.api_key_encrypted);
      const content = await generateJudgeMessage({
        trigger: "opening",
        topic: c.topic,
        plaintiffName: plaintiffProfile.display_name ?? "提案者",
        defendantName: body.defendantName.trim(),
      }, apiKey);
      if (content) {
        await admin.from("judge_messages").insert({ case_id: id, content, trigger_type: "opening" });
      }
    }
  } catch (err) {
    console.error("[judge] opening generation failed:", err);
  }
  const guestCaseData = await buildCaseResponse(admin, id);
  if (!guestCaseData) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  const guestResponse = NextResponse.json({ ...guestCaseData, callerRole: "defendant" });
  guestResponse.cookies.set(`guest_defendant_${id}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/cases/${id}`,
    maxAge: 60 * 60 * 24 * 7,
  });
  return guestResponse;
}
