'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Friend {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

interface Props {
  lawId: string;
  existingMemberIds: string[];
  pendingInviteeIds: string[];
}

export default function InvitePanel({ lawId, existingMemberIds, pendingInviteeIds }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [allFriends, setAllFriends] = useState<Friend[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const memberSet = new Set(existingMemberIds);
  const pendingSet = new Set(pendingInviteeIds);

  useEffect(() => {
    fetch("/api/friends")
      .then(r => r.json())
      .then((data: { friend: Friend }[]) => {
        setAllFriends(data.map(d => d.friend));
      })
      .catch(() => setLoadError("フレンド一覧の取得に失敗しました"));
  }, []);

  const trimmed = query.trim().toLowerCase();
  const results = trimmed
    ? allFriends.filter(f => f.display_name.toLowerCase().includes(trimmed))
    : allFriends;

  async function handleInvite(userId: string, displayName: string) {
    setError(null);
    setSuccess(null);
    setInviting(userId);
    try {
      const res = await fetch(`/api/laws/${lawId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitee_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "招待に失敗しました"); return; }
      setSuccess(`${displayName} を招待しました`);
      router.refresh();
    } catch {
      setError("招待に失敗しました");
    } finally {
      setInviting(null);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-stone-800">フレンドを招待</h2>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(null); setSuccess(null); }}
          placeholder="表示名で絞り込む"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
        />
      )}

      {!loadError && results.length > 0 && (
        <ul className="space-y-2">
          {results.map(r => {
            const isMember = memberSet.has(r.id);
            const isPending = pendingSet.has(r.id);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-stone-200 shrink-0 overflow-hidden">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <span className="text-sm text-stone-800 truncate">{r.display_name}</span>
                </div>

                {isMember ? (
                  <span className="text-xs text-stone-400 shrink-0">メンバー済み</span>
                ) : isPending ? (
                  <span className="text-xs text-stone-400 shrink-0">招待済み</span>
                ) : (
                  <button
                    onClick={() => handleInvite(r.id, r.display_name)}
                    disabled={inviting === r.id}
                    className="text-xs text-stone-800 border border-stone-300 rounded px-2 py-1 hover:bg-stone-50 disabled:opacity-50 shrink-0"
                  >
                    {inviting === r.id ? "招待中..." : "招待"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loadError && allFriends.length === 0 && (
        <p className="text-sm text-stone-400">招待できるフレンドがいません</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}
    </div>
  );
}
