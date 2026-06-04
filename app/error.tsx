"use client";

import { useEffect } from "react";
import Link from "next/link";

// Next.js のルートセグメントエラー境界。Server Component 内の `throw`
// および render 中の例外をここで受ける。Client Component の handler 内
// try/catch で local state に納められたエラーは別経路（ここに来ない）。
//
// props は Next.js が `unstable_retry` と `reset` の両方を渡す前提:
//   - `unstable_retry`: 再 fetch + 再 render（SSR データを取り直す、主用途）
//   - `reset`:          再 render のみ（fetch せず error 状態だけ clear）
// API シグネチャが将来変わっても壊れないよう両方を optional で受け、
// `unstable_retry` 優先・なければ `reset` にフォールバックする。
export default function Error({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  const retry = unstable_retry ?? reset;

  useEffect(() => {
    // dev でのみブラウザ console に詳細を出す。本番では digest 経由で
    // サーバ側ログ（Vercel Functions logs 等）から追跡する想定。
    if (process.env.NODE_ENV === "development") {
      console.error("[app/error.tsx]", error);
    }
  }, [error]);

  return (
    <main className="min-h-[60vh] bg-stone-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-rose-50 rounded-2xl mb-5 text-3xl">
            ⚠️
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">
            予期せぬエラーが発生しました
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed mb-6">
            ページの読み込み中に問題が発生しました。少し待ってから再試行してみてください。
          </p>

          {error.digest && (
            <p className="text-xs text-stone-400 font-mono mb-6 bg-stone-50 rounded-lg px-3 py-2 inline-block">
              error id: {error.digest}
            </p>
          )}

          <div className="space-y-3">
            {retry && (
              <button
                onClick={() => retry()}
                className="w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                再試行する
              </button>
            )}
            <Link
              href="/"
              className="block w-full bg-white hover:bg-stone-50 border border-stone-200 text-stone-600 font-medium py-3 rounded-xl transition-colors text-sm"
            >
              ホームに戻る
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
