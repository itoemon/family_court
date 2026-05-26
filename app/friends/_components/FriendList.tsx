"use client";

import { useState } from "react";
import Image from "next/image";
import type { FriendListItem } from "@/lib/types";

export default function FriendList({ initialFriends }: { initialFriends: FriendListItem[] }) {
  const [friends, setFriends] = useState(initialFriends);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(requestId: string) {
    setDeleting(requestId);
    const prev = friends;
    setFriends(f => f.filter(item => item.request_id !== requestId));

    try {
      const res = await fetch(`/api/friends/${requestId}`, { method: "DELETE" });
      if (!res.ok) {
        setFriends(prev);
      }
    } catch {
      setFriends(prev);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        フレンド ({friends.length})
      </h2>
      {friends.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-8 text-center">
          <p className="text-stone-400 text-sm">まだフレンドがいません</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {friends.map(item => (
            <li
              key={item.request_id}
              className="flex items-center justify-between bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {item.friend.avatar_url ? (
                  <Image
                    src={item.friend.avatar_url}
                    alt={item.friend.display_name}
                    width={36}
                    height={36}
                    className="rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center text-sm font-semibold text-brand-600">
                    {item.friend.display_name[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="text-stone-800 text-sm font-medium">
                  {item.friend.display_name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(item.request_id)}
                disabled={deleting === item.request_id}
                className="text-xs text-stone-400 hover:text-rose-500 transition-colors disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
