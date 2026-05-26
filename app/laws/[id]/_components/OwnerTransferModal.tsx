'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

interface Props {
  lawId: string;
  currentUserId: string;
  members: Member[];
  onClose: () => void;
}

export default function OwnerTransferModal({ lawId, currentUserId, members, onClose }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = members.filter(m => m.user_id !== currentUserId);

  async function handleTransfer() {
    if (!selectedId) { setError("移譲先を選択してください"); return; }
    if (!confirm("オーナー権を移譲しますか？この操作は元に戻せません。")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/owner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_owner_id: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "移譲に失敗しました"); return; }
      router.refresh();
      onClose();
    } catch {
      setError("移譲に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="font-semibold text-stone-800">オーナー権を移譲</h3>

        {candidates.length === 0 ? (
          <p className="text-sm text-stone-500">移譲できるメンバーがいません</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map(m => (
              <li key={m.user_id}>
                <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-stone-50">
                  <input
                    type="radio"
                    name="transfer-target"
                    value={m.user_id}
                    checked={selectedId === m.user_id}
                    onChange={() => setSelectedId(m.user_id)}
                    className="accent-stone-700"
                  />
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-stone-200 shrink-0 overflow-hidden">
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <span className="text-sm text-stone-800">{m.display_name}</span>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleTransfer}
            disabled={loading || candidates.length === 0}
            className="flex-1 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "移譲中..." : "移譲する"}
          </button>
        </div>
      </div>
    </div>
  );
}
