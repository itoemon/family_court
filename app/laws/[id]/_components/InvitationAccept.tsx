'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  lawId: string;
  invitationId: string;
}

export default function InvitationAccept({ lawId, invitationId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(status: "accepted" | "rejected") {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/invitations/${invitationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "処理に失敗しました");
        return;
      }
      if (status === "accepted") {
        router.refresh();
      } else {
        router.push("/laws");
      }
    } catch {
      setError("処理に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
      <p className="text-sm text-stone-700">この法律のルールに参加しますか？</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => respond("rejected")}
          disabled={loading}
          className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
        >
          拒否する
        </button>
        <button
          onClick={() => respond("accepted")}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          承認
        </button>
      </div>
    </div>
  );
}
