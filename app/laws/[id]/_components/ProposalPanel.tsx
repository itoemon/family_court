'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Vote {
  user_id: string;
  approved: boolean;
  voted_at: string;
}

interface ActiveProposal {
  id: string;
  proposal_type: "amendment" | "deletion";
  proposed_by: string;
  proposed_article: string | null;
  created_at: string;
  votes: Vote[];
}

interface Member {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

interface Props {
  lawId: string;
  isOwner: boolean;
  isMember: boolean;
  members: Member[];
  currentUserId: string;
  activeProposal: ActiveProposal | null;
}

const ARTICLE_MAX = 2000;

export default function ProposalPanel({
  lawId,
  isOwner,
  members,
  currentUserId,
  activeProposal,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAmendForm, setShowAmendForm] = useState(false);
  const [proposedArticle, setProposedArticle] = useState("");

  async function handleVote() {
    if (!activeProposal) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/proposals/${activeProposal.id}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "投票に失敗しました"); return; }
      router.refresh();
    } catch {
      setError("投票に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdraw() {
    if (!activeProposal) return;
    if (!confirm("提案を取り下げますか？")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/proposals/${activeProposal.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "取り下げに失敗しました"); return; }
      router.refresh();
    } catch {
      setError("取り下げに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function handlePropose(type: "amendment" | "deletion") {
    if (type === "amendment") {
      if (proposedArticle.trim().length === 0) { setError("条文を入力してください"); return; }
      if (proposedArticle.length > ARTICLE_MAX) { setError(`条文は${ARTICLE_MAX}文字以内で入力してください`); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { proposal_type: type };
      if (type === "amendment") body.proposed_article = proposedArticle.trim();
      const res = await fetch(`/api/laws/${lawId}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "提案に失敗しました"); return; }
      setShowAmendForm(false);
      setProposedArticle("");
      router.refresh();
    } catch {
      setError("提案に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  const myVote = activeProposal?.votes.find(v => v.user_id === currentUserId);
  const approvedCount = activeProposal?.votes.filter(v => v.approved).length ?? 0;
  const totalCount = members.length;
  const memberMap = new Map(members.map(m => [m.user_id, m.display_name]));

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
      <h2 className="font-semibold text-stone-800">提案</h2>

      {activeProposal ? (
        <div className="space-y-4">
          <div className="bg-stone-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                activeProposal.proposal_type === "deletion"
                  ? "bg-red-100 text-red-700"
                  : "bg-blue-100 text-blue-700"
              }`}>
                {activeProposal.proposal_type === "deletion" ? "削除提案" : "改定案"}
              </span>
              <span className="text-xs text-stone-400">
                {memberMap.get(activeProposal.proposed_by) ?? "不明"} が提出
              </span>
            </div>

            {activeProposal.proposal_type === "amendment" && activeProposal.proposed_article && (
              <div>
                <p className="text-xs text-stone-500 mb-1">改定後の条文</p>
                <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                  {activeProposal.proposed_article}
                </p>
              </div>
            )}

            {activeProposal.proposal_type === "deletion" && (
              <p className="text-sm text-red-600">この法律の削除を提案しています。全メンバーが承認すると法律が削除されます。</p>
            )}

            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>承認済み: {approvedCount} / {totalCount} 人</span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!myVote?.approved && (
              <button
                onClick={handleVote}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                賛成する
              </button>
            )}
            {myVote?.approved && (
              <span className="px-4 py-2 bg-green-100 text-green-700 text-sm rounded-lg">
                賛成済み
              </span>
            )}
            {isOwner && (
              <button
                onClick={handleWithdraw}
                disabled={loading}
                className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50 disabled:opacity-50"
              >
                取り下げ
              </button>
            )}
          </div>
        </div>
      ) : showAmendForm ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-stone-700">改定後の条文</label>
          <textarea
            value={proposedArticle}
            onChange={e => setProposedArticle(e.target.value)}
            maxLength={ARTICLE_MAX}
            rows={6}
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 resize-none"
          />
          <p className="text-right text-xs text-stone-400">{proposedArticle.length} / {ARTICLE_MAX}</p>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowAmendForm(false); setProposedArticle(""); setError(null); }}
              className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50"
            >
              キャンセル
            </button>
            <button
              onClick={() => handlePropose("amendment")}
              disabled={loading}
              className="px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50"
            >
              {loading ? "提出中..." : "改定案を提出"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowAmendForm(true)}
            className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50"
          >
            改定案を提出する
          </button>
          {isOwner && (
            <button
              onClick={() => handlePropose("deletion")}
              disabled={loading}
              className="px-4 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              削除を提案する
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
