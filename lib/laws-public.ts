import type { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { PublicLawListItem } from "@/lib/types";

type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

// Hub 一覧の件数上限（MVP）。新着 50 件固定。FEAT-004 設計「件数上限 = 50」参照。
export const PUBLIC_LAWS_LIMIT = 50;

// 検索語の上限。name 最大長 100 に整合させる。
const QUERY_MAX_LEN = 100;

// LIKE/ILIKE のワイルドカード（% _）と escape 文字（\）を無効化し、
// 全件マッチや意図しないパターン注入を防ぐ。\ を先に処理すること。
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

// 検索語を正規化する（trim + 長さ上限 + LIKE エスケープ）。空なら null（無条件）。
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, QUERY_MAX_LEN);
  if (trimmed.length === 0) return null;
  return escapeLike(trimmed);
}

interface FetchArgs {
  sessionClient: SessionClient;
  adminClient: AdminClient;
  q: string | null;
}

// 公開法律一覧を取得・整形する共有ロジック。
// Hub ページ（Server Component）と GET /api/laws/public が共有し、
// 取得・整形（owner_id 除去・display_name 解決・件数上限）の二重実装を避ける。
export async function fetchPublicLaws({
  sessionClient,
  adminClient,
  q,
}: FetchArgs): Promise<PublicLawListItem[]> {
  // laws 本体は session client で読む（新 RLS laws_select_public で二層防御）。
  let query = sessionClient
    .from("laws")
    .select("id, name, article, owner_id, created_at")
    .eq("is_public", true);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data: laws, error } = await query
    .order("created_at", { ascending: false })
    .limit(PUBLIC_LAWS_LIMIT);

  if (error) {
    console.error("[fetchPublicLaws] laws query failed:", error);
    throw error;
  }

  if (!laws || laws.length === 0) return [];

  // オーナーは他人であり、profiles 他人行は session では読めないため
  // display_name のみ admin で narrow にバッチ取得する（機微列は SELECT しない）。
  const ownerIds = [...new Set(laws.map(l => l.owner_id))];
  const { data: ownerProfiles } = await adminClient
    .from("profiles")
    .select("id, display_name")
    .in("id", ownerIds);

  const nameMap = new Map((ownerProfiles ?? []).map(p => [p.id, p.display_name]));

  // owner_id は応答境界で捨てる。
  return laws.map(law => ({
    id: law.id,
    name: law.name,
    article: law.article,
    owner_display_name: nameMap.get(law.owner_id) ?? "（名前未設定）",
    created_at: law.created_at,
  }));
}
