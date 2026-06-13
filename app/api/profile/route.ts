import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { encryptApiKey } from "@/lib/crypto";
import { validateApiKey } from "@/lib/claude";
import { validateGreeting } from "@/lib/greetings";

export async function PATCH(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const {
    displayName,
    apiKey,
    defenseCustomInstruction,
    openingGreeting,
    closingGreeting,
  } = await req.json();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (displayName !== undefined) {
    updates.display_name = displayName;
  }

  if (apiKey) {
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return NextResponse.json(
        { error: "APIキーが無効です。Anthropic コンソールで確認してください。" },
        { status: 400 }
      );
    }
    updates.api_key_encrypted = encryptApiKey(apiKey);
  }

  if (defenseCustomInstruction !== undefined) {
    if (defenseCustomInstruction !== null && typeof defenseCustomInstruction !== "string") {
      return NextResponse.json({ error: "無効なリクエストです" }, { status: 400 });
    }
    const instruction = defenseCustomInstruction === "" ? null : defenseCustomInstruction;
    if (instruction !== null && instruction.length > 200) {
      return NextResponse.json(
        { error: "弁護人への指示は200文字以内にしてください" },
        { status: 400 }
      );
    }
    updates.defense_custom_instruction = instruction;
  }

  if (openingGreeting !== undefined) {
    const result = validateGreeting(openingGreeting, "開始時の挨拶");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    updates.opening_greeting = result.value;
  }

  if (closingGreeting !== undefined) {
    const result = validateGreeting(closingGreeting, "終了時の挨拶");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    updates.closing_greeting = result.value;
  }

  const admin = createAdminClient();
  const { data: updatedProfile, error } = await admin
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("api_key_encrypted, opening_greeting, closing_greeting")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    hasApiKey: !!updatedProfile?.api_key_encrypted,
    openingGreeting: updatedProfile?.opening_greeting ?? null,
    closingGreeting: updatedProfile?.closing_greeting ?? null,
    success: true,
  });
}
