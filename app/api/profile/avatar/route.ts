import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = (typeof ALLOWED_MIME)[number];
const MAX_SIZE = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<AllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: NextRequest) {
  const session = await createSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 400 });
  }

  const mimeType = file.type as AllowedMime;
  if (!ALLOWED_MIME.includes(mimeType)) {
    return NextResponse.json({ error: "JPEG・PNG・WebP のみ対応しています" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "ファイルサイズは2MB以下にしてください" }, { status: 400 });
  }

  const ext = MIME_TO_EXT[mimeType];
  const newPath = `${user.id}/avatar.${ext}`;

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();

  if (profile?.avatar_url) {
    try {
      const url = new URL(profile.avatar_url);
      const prefix = "/storage/v1/object/public/avatars/";
      if (url.pathname.startsWith(prefix)) {
        const oldPath = url.pathname.slice(prefix.length);
        if (oldPath !== newPath) {
          await admin.storage.from("avatars").remove([oldPath]);
        }
      }
    } catch {
      // 旧ファイルの削除失敗はアップロードを止めない
    }
  }

  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(newPath, bytes, { contentType: mimeType, upsert: true });

  if (uploadError) {
    console.error("[avatar] upload failed:", uploadError);
    return NextResponse.json({ error: "アップロードに失敗しました" }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from("avatars").getPublicUrl(newPath);
  const avatarUrl = `${publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (updateError) {
    console.error("[avatar] profile update failed:", updateError);
    return NextResponse.json({ error: "プロフィールの更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ avatar_url: avatarUrl });
}
