"use client";

import { useState } from "react";
import Image from "next/image";
import type { FriendProfile } from "@/lib/types";

export default function SearchSection() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setError("");
    setSearched(false);
    setResults([]);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "検索に失敗しました");
        return;
      }
      const data = await res.json();
      setResults(data as FriendProfile[]);
      setSearched(true);
    } catch {
      setError("検索中にエラーが発生しました");
    } finally {
      setSearching(false);
    }
  }

  async function handleSendRequest(userId: string) {
    setSending(userId);
    try {
      const res = await fetch("/api/friends/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiver_id: userId }),
      });
      if (res.ok) {
        setSent(prev => new Set([...prev, userId]));
      }
    } finally {
      setSending(null);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        ユーザーを検索
      </h2>
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="表示名またはメールアドレス"
          className="flex-1 bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
        >
          {searching ? "検索中..." : "検索"}
        </button>
      </form>

      {error && <p className="text-sm text-rose-500 mb-3">{error}</p>}

      {searched && results.length === 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 text-center">
          <p className="text-stone-400 text-sm">ユーザーが見つかりませんでした</p>
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map(user => (
            <li
              key={user.id}
              className="flex items-center justify-between bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.display_name}
                    width={36}
                    height={36}
                    className="rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center text-sm font-semibold text-brand-600">
                    {user.display_name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="text-stone-800 text-sm font-medium">{user.display_name}</span>
              </div>
              <button
                type="button"
                onClick={() => handleSendRequest(user.id)}
                disabled={sending === user.id || sent.has(user.id)}
                className="text-xs bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {sent.has(user.id)
                  ? "送信済み"
                  : sending === user.id
                  ? "送信中..."
                  : "リクエストを送る"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
