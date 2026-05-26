"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingInvitation {
  id: string;
  lawId: string;
  lawName: string;
  ownerName: string;
}

interface Props {
  invitations: PendingInvitation[];
}

export default function PendingInvitations({ invitations }: Props) {
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  async function respond(lawId: string, invId: string, status: "accepted" | "rejected") {
    setProcessingId(invId);
    try {
      await fetch(`/api/laws/${lawId}/invitations/${invId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">届いた招待</h2>
      <ul className="space-y-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-5 py-4"
          >
            <div>
              <p className="font-semibold text-stone-800">{inv.lawName}</p>
              <p className="text-stone-500 text-sm">from {inv.ownerName}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => respond(inv.lawId, inv.id, "accepted")}
                disabled={processingId === inv.id}
                className="px-3 py-1.5 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
              >
                承認
              </button>
              <button
                onClick={() => respond(inv.lawId, inv.id, "rejected")}
                disabled={processingId === inv.id}
                className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 text-sm rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
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
