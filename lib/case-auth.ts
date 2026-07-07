import { NextRequest } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";

// 対象ケースへの参加者認可を一元判定する共通ヘルパー（SEC-001）。
// 認証ユーザーは user.id ∈ {plaintiff_id, defendant_id}、ゲスト被告は guest token 検証。
// 返り値は失敗時 { error, status }、成功時 { user, userId, c, userRole, admin }（判別は "error" in auth）。
// defense / verdict など Claude を呼ぶルートは、AI 呼び出しの前に必ずこれを通すこと。
export async function resolveCaseAuth(req: NextRequest, id: string) {
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
    console.error("[case-auth] createSessionClient failed:", err);
    return { error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 } as const;
  }

  if (c.defendant_guest_name) {
    try {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && await verifyGuestToken(id, cookieToken)) {
        return { user: null, userId: null as string | null, c, userRole: "defendant" as const, admin } as const;
      }
    } catch (err) {
      console.error("[case-auth] verifyGuestToken failed:", err);
      return { error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 } as const;
    }
  }

  return { error: "認証が必要です", status: 401 } as const;
}
