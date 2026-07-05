"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();
  const supabase = createClient();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, api_key_encrypted, credits")
        .eq("id", user.id)
        .single();

      if (profile) {
        setDisplayName(profile.display_name);
        setHasApiKey(!!profile.api_key_encrypted);
        setCredits(profile.credits ?? null);
      }
    }
    load();
  }, [supabase, router]);

  // MON-001: 非 BYOK かつクレジット 0 のとき作成を抑止する。サーバ 402 が最終防波堤。
  const creditBlocked = !hasApiKey && credits === 0;

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/case/${data.id}?role=plaintiff`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-100 rounded-2xl mb-4 text-3xl">
            ⚖️
          </div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">igiari</h1>
          <p className="mt-2 text-stone-500 text-sm">大切な人と、おだやかに話し合うための場所</p>
        </div>

        {/* MON-001: クレジット不足の警告（非 BYOK かつ残高 0）。作成を抑止する。 */}
        {displayName && creditBlocked && (
          <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 mb-5 flex items-start gap-3">
            <span className="text-lg shrink-0">🚫</span>
            <div>
              <p className="text-rose-600 text-sm font-medium">クレジットが不足しています</p>
              <p className="text-rose-500 text-xs mt-0.5">
                ご自分の Claude API キーを
                <Link href="/profile" className="underline font-semibold mx-1">プロフィール</Link>
                から登録（BYOK）すると無料でご利用いただけます。
              </p>
              <p className="text-rose-400 text-xs mt-1">
                クレジットの購入は準備中です。
              </p>
            </div>
          </div>
        )}

        {/* APIキー未登録の警告（クレジットは残っている状態） */}
        {displayName && !hasApiKey && !creditBlocked && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 mb-5 flex items-start gap-3">
            <span className="text-lg shrink-0">⚠️</span>
            <div>
              <p className="text-amber-700 text-sm font-medium">AIのAPIキーが未登録です</p>
              <p className="text-amber-600 text-xs mt-0.5">
                APIキーを登録すると無料で話し合えます（未登録の場合、作成ごとに1クレジット消費・残り {credits ?? "-"}）。
                <Link href="/profile" className="underline font-semibold ml-1">プロフィール</Link>
                から登録できます。
              </p>
            </div>
          </div>
        )}

        {/* Form */}
        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-8 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              話し合いたいこと
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例：今晩の夕食はラーメンかカレーか"
              maxLength={200}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm"
            />
            <p className="text-right text-xs text-stone-400 mt-0.5">{topic.length}/200</p>
          </div>

          {error && (
            <p className="text-rose-500 text-sm bg-rose-50 border border-rose-100 rounded-xl px-4 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || !topic.trim() || creditBlocked}
            className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? "準備中..." : creditBlocked ? "クレジット不足" : "はじめる"}
          </button>
        </div>

        {/* Footer nav */}
        <div className="flex justify-center gap-6 mt-5">
          <Link href="/profile" className="text-stone-400 hover:text-stone-600 text-xs transition-colors">
            👤 {displayName || "プロフィール"}
          </Link>
        </div>
      </div>
    </main>
  );
}
