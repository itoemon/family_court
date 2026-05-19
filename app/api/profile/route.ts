import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { encryptApiKey } from "@/lib/crypto";
import { validateApiKey } from "@/lib/claude";

export async function PATCH(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const { displayName, apiKey } = await req.json();

  const updates: Record<string, string> = {
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };

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

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(updates).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
