import { Suspense } from "react";
import LoginForm from "./LoginForm";

// useSearchParams() を呼ぶ LoginForm を Suspense 境界でラップする。
// BUG-008: Next.js 16 App Router の公式ガイダンス遵守と、将来の静的最適化への備え。
function LoginFormSkeleton() {
  return (
    <main
      className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="ログインフォームを読み込み中"
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-100 rounded-2xl mb-4 text-2xl">
            ⚖️
          </div>
          <h1 className="text-2xl font-bold text-stone-800">ログイン</h1>
          <p className="mt-1 text-stone-500 text-sm">igiari へようこそ</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-7 space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                メールアドレス
              </label>
              <div className="w-full h-12 bg-stone-100 rounded-xl animate-pulse" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                パスワード
              </label>
              <div className="w-full h-12 bg-stone-100 rounded-xl animate-pulse" />
            </div>
            <div className="w-full h-12 bg-stone-200 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFormSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
