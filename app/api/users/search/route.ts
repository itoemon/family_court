import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: false,
});

export async function GET(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const { success, limit, remaining, reset } = await ratelimit.limit(user.id);
  if (!success) {
    const resetSec = Math.ceil(reset / 1000);
    const retryAfter = Math.max(0, resetSec - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit":     String(limit),
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset":     String(resetSec),
          "Retry-After":           String(retryAfter),
        },
      }
    );
  }

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 1 || q.length > 100) {
    return NextResponse.json({ error: "検索クエリは1〜100文字で指定してください" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("search_users", {
    query: q,
    current_uid: user.id,
  });

  if (error) {
    console.error("[users/search] rpc failed:", error);
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
