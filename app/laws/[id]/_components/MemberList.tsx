'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import OwnerTransferModal from "./OwnerTransferModal";

interface Member {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  joined_at: string;
}

interface Props {
  lawId: string;
  currentUserId: string;
  isOwner: boolean;
  ownerId: string;
  members: Member[];
}

export default function MemberList({ lawId, currentUserId, isOwner, ownerId, members }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);

  async function handleLeave() {
    if (!confirm("この法律から退会しますか？")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/members/me`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "退会に失敗しました"); return; }
      router.push("/laws");
    } catch {
      setError("退会に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-stone-800">メンバー {members.length}人</h2>

      <ul className="space-y-3">
        {members.map(member => {
          const isMe = member.user_id === currentUserId;
          const isMemberOwner = member.user_id === ownerId;
          return (
            <li key={member.user_id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-stone-200 shrink-0 overflow-hidden">
                  {member.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">
                    {member.display_name}
                    {isMemberOwner && (
                      <span className="ml-2 text-xs text-amber-600 font-normal">オーナー</span>
                    )}
                    {isMe && <span className="ml-1 text-xs text-stone-400">(自分)</span>}
                  </p>
                  <p className="text-xs text-stone-400">
                    {new Date(member.joined_at).toLocaleDateString("ja-JP")} 参加
                  </p>
                </div>
              </div>

              {isMe && isOwner && (
                <button
                  onClick={() => setShowTransferModal(true)}
                  className="text-xs text-stone-600 border border-stone-300 rounded px-2 py-1 hover:bg-stone-50 shrink-0"
                >
                  権限を移譲
                </button>
              )}
              {isMe && !isOwner && (
                <button
                  onClick={handleLeave}
                  disabled={loading}
                  className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50 shrink-0"
                >
                  退会する
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showTransferModal && (
        <OwnerTransferModal
          lawId={lawId}
          currentUserId={currentUserId}
          members={members}
          onClose={() => setShowTransferModal(false)}
        />
      )}
    </div>
  );
}
