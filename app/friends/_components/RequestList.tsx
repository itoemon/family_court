"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { IncomingRequest } from "@/lib/types";

export default function RequestList({ initialRequests }: { initialRequests: IncomingRequest[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [acting, setActing] = useState<string | null>(null);

  async function handleAction(id: string, action: "accept" | "reject") {
    setActing(id);
    try {
      const res = await fetch(`/api/friends/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setRequests(r => r.filter(req => req.id !== id));
        if (action === "accept") router.refresh();
      }
    } finally {
      setActing(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        受信したリクエスト ({requests.length})
      </h2>
      <ul className="space-y-2">
        {requests.map(req => (
          <li
            key={req.id}
            className="flex items-center justify-between bg-white rounded-2xl border border-stone-100 shadow-sm px-4 py-3"
          >
            <div className="flex items-center gap-3">
              {req.sender.avatar_url ? (
                <Image
                  src={req.sender.avatar_url}
                  alt={req.sender.display_name}
                  width={36}
                  height={36}
                  className="rounded-xl object-cover"
                />
              ) : (
                <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center text-sm font-semibold text-brand-600">
                  {req.sender.display_name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <span className="text-stone-800 text-sm font-medium">
                {req.sender.display_name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAction(req.id, "accept")}
                disabled={acting === req.id}
                className="text-xs bg-brand-700 hover:bg-brand-800 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                承認
              </button>
              <button
                type="button"
                onClick={() => handleAction(req.id, "reject")}
                disabled={acting === req.id}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-50"
              >
                拒否
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
