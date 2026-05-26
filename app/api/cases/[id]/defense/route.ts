import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { decryptApiKey } from "@/lib/crypto";
import { generateDefenseResponse } from "@/lib/defense";
import { DefenseMessage } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveAuth(req: NextRequest, id: string) {
  const admin = createAdminClient();
  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return { error: "ケースが見つかりません", status: 404 } as const;

  try {
    const session = await createSessionClient();
    const { data: { user } } = await session.auth.getUser();

    if (user) {
      if (user.id !== c.plaintiff_id && user.id !== c.defendant_id) {
        return { error: "このケースへの参加権限がありません", status: 403 } as const;
      }
      const userRole: "plaintiff" | "defendant" =
        user.id === c.plaintiff_id ? "plaintiff" : "defendant";
      return { user, userId: user.id as string | null, c, userRole, admin } as const;
    }
  } catch (err) {
    console.error("createSessionClient failed:", err);
    return { error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 } as const;
  }

  if (c.defendant_guest_name) {
    try {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && await verifyGuestToken(id, cookieToken)) {
        return { user: null, userId: null, c, userRole: "defendant" as const, admin } as const;
      }
    } catch (err) {
      console.error("verifyGuestToken failed:", err);
      return { error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 } as const;
    }
  }

  return { error: "認証が必要です", status: 401 } as const;
}

async function resolveApiKey(plaintiffId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("api_key_encrypted, defense_custom_instruction")
    .eq("id", plaintiffId)
    .single();

  if (!plaintiffProfile?.api_key_encrypted) {
    console.error(`[defense] plaintiff ${plaintiffId} has no api_key_encrypted`);
    return { error: "APIキーが設定されていません", status: 500 } as const;
  }

  try {
    return {
      apiKey: decryptApiKey(plaintiffProfile.api_key_encrypted),
      customInstruction: (plaintiffProfile.defense_custom_instruction as string | null) ?? null,
    } as const;
  } catch (err) {
    console.error("[defense] api key decryption failed:", err);
    return { error: "APIキーの復号に失敗しました", status: 500 } as const;
  }
}

function toDefenseMessage(row: {
  id: string;
  role: string;
  content: string;
  created_at: string;
}): DefenseMessage {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  const auth = await resolveAuth(req, id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId, admin } = auth;

  const baseQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: rows } = userId
    ? await baseQuery.eq("user_id", userId)
    : await baseQuery.is("user_id", null);

  const messages: DefenseMessage[] = (rows ?? []).map(toDefenseMessage);
  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  const auth = await resolveAuth(req, id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId, c, userRole, admin } = auth;

  const keyResult = await resolveApiKey(c.plaintiff_id, admin);
  if ("error" in keyResult) {
    return NextResponse.json({ error: keyResult.error }, { status: keyResult.status });
  }
  const { apiKey, customInstruction } = keyResult;

  const body = await req.json();
  const content: string = body.content ?? "";
  if (!content.trim()) {
    return NextResponse.json({ error: "内容を入力してください" }, { status: 400 });
  }
  if (content.trim().length > 1000) {
    return NextResponse.json({ error: "1000文字以内で入力してください" }, { status: 400 });
  }

  const existingQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: existingRows } = userId
    ? await existingQuery.eq("user_id", userId)
    : await existingQuery.is("user_id", null);

  const { data: argumentRows } = await admin
    .from("arguments")
    .select("role, content")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const dialogHistory = (argumentRows ?? []).map((a) => ({
    role: a.role as "plaintiff" | "defendant",
    content: a.content as string,
  }));

  const defenseHistoryForAI = [
    ...(existingRows ?? []).map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content as string,
    })),
    { role: "user" as const, content: content.trim() },
  ];

  let aiText: string;
  try {
    aiText = await generateDefenseResponse(
      {
        topic: c.topic,
        dialogHistory,
        defenseHistory: defenseHistoryForAI,
        userRole,
        customInstruction,
      },
      apiKey
    );
  } catch (err) {
    console.error("[defense] AI generation failed:", err);
    return NextResponse.json({ error: "AI応答の生成に失敗しました" }, { status: 500 });
  }

  if (!aiText.trim()) {
    console.error("[defense] AI returned empty response");
    return NextResponse.json({ error: "AI応答の生成に失敗しました" }, { status: 500 });
  }

  const { error: insertUserError } = await admin
    .from("defense_messages")
    .insert({ case_id: id, user_id: userId, role: "user", content: content.trim() });
  if (insertUserError) {
    console.error("[defense] user message insert failed:", insertUserError);
    return NextResponse.json({ error: "メッセージの保存に失敗しました" }, { status: 500 });
  }

  const { error: insertAIError } = await admin
    .from("defense_messages")
    .insert({ case_id: id, user_id: userId, role: "assistant", content: aiText });
  if (insertAIError) {
    console.error("[defense] AI message insert failed:", insertAIError);
    return NextResponse.json({ error: "AI応答の保存に失敗しました" }, { status: 500 });
  }

  const latestQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: latestRows } = userId
    ? await latestQuery.eq("user_id", userId)
    : await latestQuery.is("user_id", null);

  const messages: DefenseMessage[] = (latestRows ?? []).map(toDefenseMessage);
  return NextResponse.json({ messages });
}
