import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // セッションを常に最新に保つ（これを省くとログアウトが正常に動かない）
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const PROTECTED_PATH_PREFIXES = ["/history", "/profile", "/friends", "/laws", "/me"];
  const isProtected =
    pathname === "/" ||
    pathname === "/case/new" ||
    PROTECTED_PATH_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"));
  if (!user && isProtected) {
    // 保護パスへのアクセスを ?next= に記録し、ログイン成功後に元のページへ戻れるようにする。
    // 値は内部パスのみで構成される (request.nextUrl.pathname / search はサーバ側で
    // 認識した相対パス + クエリ)。ログインページ側の open redirect ガード
    // (app/auth/login/page.tsx の `new URL()` + origin 一致チェック) が二重に防御する。
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
