"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [plaintiffName, setPlaintiffName] = useState("");
  const [maxRounds, setMaxRounds] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, plaintiffName, maxRounds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/case/${data.id}?role=plaintiff&name=${encodeURIComponent(plaintiffName)}`);
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
          <div className="inline-flex items-center justify-center w-16 h-16 bg-rose-100 rounded-2xl mb-4 text-3xl">
            ⚖️
          </div>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">家庭裁判所</h1>
          <p className="mt-2 text-stone-500 text-sm">
            大切な人と、おだやかに話し合うための場所
          </p>
        </div>

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
              required
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              あなたの名前
            </label>
            <input
              type="text"
              value={plaintiffName}
              onChange={(e) => setPlaintiffName(e.target.value)}
              placeholder="例：たろう"
              required
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              やりとりの回数
            </label>
            <select
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-700 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition text-sm"
            >
              <option value={2}>2回（さらっと）</option>
              <option value={3}>3回（ちょうどよく）</option>
              <option value={5}>5回（じっくりと）</option>
            </select>
          </div>

          {error && (
            <p className="text-rose-500 text-sm bg-rose-50 border border-rose-100 rounded-xl px-4 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            onClick={handleCreate}
            disabled={loading || !topic.trim() || !plaintiffName.trim()}
            className="w-full bg-rose-400 hover:bg-rose-300 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? "準備中..." : "はじめる"}
          </button>
        </div>

        <p className="text-center text-stone-400 text-xs mt-6">
          作成後、相手にリンクを共有してください
        </p>
      </div>
    </main>
  );
}
