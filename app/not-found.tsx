import Link from "next/link";

// Next.js の `notFound()` 呼び出しを受ける 404 画面。
// 例: `app/case/[id]/page.tsx` で UUID 不正・ケース不存在のとき。
export default function NotFound() {
  return (
    <main className="min-h-[60vh] bg-stone-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-50 rounded-2xl mb-5 text-3xl">
            🔍
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">
            ページが見つかりません
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed mb-6">
            URL が間違っているか、リンクが古くなっている可能性があります。
          </p>

          <Link
            href="/"
            className="block w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            ホームに戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
