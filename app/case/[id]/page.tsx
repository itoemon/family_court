"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Case, Role, Argument, JudgeMessage, ContradictionWarning, DefenseMessage } from "@/lib/types";
import JudgeMessageBubble from "@/app/components/JudgeMessageBubble";
import ContradictionWarningBubble from "@/app/components/ContradictionWarningBubble";
import DefenseChat from "@/app/components/DefenseChat";
import DraftModal from "@/app/components/DraftModal";

const PHASE_LABELS: Record<string, string> = {
  waiting: "相手の参加を待っています",
  opening: "はじめのひとこと",
  argument: "主張・反論",
  closing: "最後のひとこと",
  judging: "AI が審議中...",
  verdict: "判決済み",
};

const ROLE_LABELS: Record<Role, string> = {
  plaintiff: "提案者",
  defendant: "反対者",
};

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const [caseId, setCaseId] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [joinName, setJoinName] = useState("");
  const [joinMode, setJoinMode] = useState<"choose" | "guest" | "login">("choose");
  const [argumentText, setArgumentText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [requestingVerdict, setRequestingVerdict] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 弁護人AI state
  const [activeView, setActiveView] = useState<"dialog" | "defense">("dialog");
  const [defenseMessages, setDefenseMessages] = useState<DefenseMessage[]>([]);
  const [defenseInput, setDefenseInput] = useState("");
  const [defenseLoading, setDefenseLoading] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [showDefenseTab, setShowDefenseTab] = useState(false);

  useEffect(() => {
    params.then(({ id }) => setCaseId(id));
  }, [params]);

  const roleParam = searchParams.get("role") as Role | null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (roleParam === "plaintiff") setMyRole("plaintiff");
  }, [roleParam]);

  useEffect(() => {
    if (!caseId || roleParam === "plaintiff") return;
    async function restoreRole() {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) return;
      const data: Case = await res.json();
      if (data.callerRole === "plaintiff" || data.callerRole === "defendant") {
        setMyRole(data.callerRole);
      }
      setCaseData(data);
    }
    restoreRole();
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCase = useCallback(async () => {
    if (!caseId) return;
    try {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) return;
      const data: Case = await res.json();
      setCaseData(data);
      if (data.phase === "verdict") router.push(`/case/${caseId}/verdict`);
    } catch { /* ignore polling errors */ }
  }, [caseId, router]);

  useEffect(() => {
    if (!caseId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCase();
    const interval = setInterval(fetchCase, 2000);
    return () => clearInterval(interval);
  }, [caseId, fetchCase]);

  useEffect(() => {
    if (caseData?.phase === "judging" && !requestingVerdict) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRequestingVerdict(true);
      fetch(`/api/cases/${caseId}/verdict`, { method: "POST" })
        .then(() => fetchCase())
        .catch(() => setRequestingVerdict(false));
    }
  }, [caseData?.phase, caseId, fetchCase, requestingVerdict]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [caseData?.arguments?.length, caseData?.judgeMessages?.length]);

  async function handleJoinAsAccount() {
    setError("");
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push(`/auth/login?next=/case/${caseId}`); return; }
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asGuest: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMyRole("defendant");
      setCaseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinAsGuest(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asGuest: true, defendantName: joinName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMyRole("defendant");
      setCaseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitArgument(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!myRole || !argumentText.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/argument`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: argumentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaseData(data);
      setArgumentText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  function copyShareLink() {
    const url = `${window.location.origin}/case/${caseId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fetchDefenseMessages = useCallback(async () => {
    if (!caseId) return;
    const res = await fetch(`/api/cases/${caseId}/defense`);
    if (res.status === 401 || res.status === 403) {
      setShowDefenseTab(false);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    setDefenseMessages(data.messages ?? []);
    setShowDefenseTab(true);
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;
    fetchDefenseMessages();
  }, [caseId, fetchDefenseMessages]);

  async function handleSendDefense(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!defenseInput.trim()) return;
    setDefenseLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/defense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: defenseInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDefenseMessages(data.messages ?? []);
      setDefenseInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setDefenseLoading(false);
    }
  }

  async function handleGenerateDraft() {
    setDraftLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/defense/draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraftText(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setDraftLoading(false);
    }
  }

  function handleSubmitDraft(finalText: string) {
    setArgumentText(finalText);
    setDraftText(null);
    setActiveView("dialog");
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  // ── 被告参加画面 ──────────────────────────────────────────
  if (!myRole && caseData.phase === "waiting") {
    return (
      <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-100 rounded-2xl mb-4 text-2xl">⚖️</div>
            <h1 className="text-2xl font-bold text-stone-800">話し合いに招待されています</h1>
            <p className="mt-2 text-stone-500 text-sm">あなたの意見を聞かせてください</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-5 mb-4">
            <p className="text-xs text-stone-400 mb-1">テーマ</p>
            <p className="text-stone-800 font-semibold">{caseData.topic}</p>
            <p className="text-xs text-stone-400 mt-3">{caseData.plaintiff?.name} さんが提案しています</p>
          </div>

          {joinMode === "choose" && (
            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6 space-y-3">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">参加方法を選んでください</p>
              <button
                onClick={() => setJoinMode("login")}
                className="w-full bg-indigo-400 hover:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                アカウントでログインして参加
              </button>
              <button
                onClick={() => setJoinMode("guest")}
                className="w-full bg-white hover:bg-stone-50 border border-stone-200 text-stone-600 font-medium py-3 rounded-xl transition-colors text-sm"
              >
                ゲストとして参加（名前だけ入力）
              </button>
            </div>
          )}

          {joinMode === "login" && (
            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6 space-y-3">
              <button
                onClick={handleJoinAsAccount}
                disabled={loading}
                className="w-full bg-indigo-400 hover:bg-indigo-300 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {loading ? "参加中..." : "ログインして参加する"}
              </button>
              <p className="text-center text-xs text-stone-400">
                アカウントをお持ちでない方は
                <Link href={`/auth/signup`} className="text-indigo-400 font-semibold ml-1">新規登録</Link>
              </p>
              {error && <p className="text-rose-500 text-sm">{error}</p>}
              <button onClick={() => setJoinMode("choose")} className="w-full text-stone-400 text-xs py-1">← 戻る</button>
            </div>
          )}

          {joinMode === "guest" && (
            <form onSubmit={handleJoinAsGuest} className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">あなたの名前</label>
                <input
                  type="text"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  placeholder="例：はなこ"
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent transition text-sm"
                />
              </div>
              {error && <p className="text-rose-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-400 hover:bg-indigo-300 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {loading ? "参加中..." : "ゲストで参加する"}
              </button>
              <button type="button" onClick={() => setJoinMode("choose")} className="w-full text-stone-400 text-xs py-1">← 戻る</button>
            </form>
          )}
        </div>
      </main>
    );
  }

  // ── メイン裁判室 ──────────────────────────────────────────
  type TimelineItem =
    | { type: "argument"; data: Argument }
    | { type: "judge"; data: JudgeMessage };

  const timeline: TimelineItem[] = [
    ...caseData.arguments.map((a) => ({ type: "argument" as const, data: a })),
    ...caseData.judgeMessages.map((j) => ({ type: "judge" as const, data: j })),
  ].sort((a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime());

  const isMyTurn = myRole && caseData.currentTurn === myRole;
  const canSpeak = isMyTurn && !["waiting", "judging", "verdict"].includes(caseData.phase);
  const opponentName = myRole === "plaintiff" ? caseData.defendant?.name : caseData.plaintiff?.name;
  const warningMap = new Map(
    (caseData.contradictionWarnings ?? []).map((w) => [w.argumentId, w])
  );

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-stone-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-lg shrink-0">⚖️</span>
            <div className="min-w-0">
              <p className="font-semibold text-stone-800 text-sm truncate">{caseData.topic}</p>
              <p className="text-xs text-stone-400 mt-0.5">{PHASE_LABELS[caseData.phase]}</p>
            </div>
          </div>
          <button
            onClick={copyShareLink}
            className="shrink-0 text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? "✓ コピー済" : "リンクを共有"}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full px-4 pt-4 pb-2 flex items-center gap-3">
        <PlayerChip
          name={caseData.plaintiff?.name ?? "—"}
          role="plaintiff"
          isActive={caseData.currentTurn === "plaintiff" && caseData.phase !== "waiting"}
          isMe={myRole === "plaintiff"}
        />
        <span className="text-stone-300 text-sm font-medium">vs</span>
        <PlayerChip
          name={caseData.defendant?.name ?? "参加待ち"}
          role="defendant"
          isActive={caseData.currentTurn === "defendant" && caseData.phase !== "waiting"}
          isMe={myRole === "defendant"}
        />
      </div>

      {showDefenseTab && myRole && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-3 flex gap-2">
          <button
            onClick={() => setActiveView("dialog")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeView === "dialog"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-white text-stone-400 border border-stone-200"
            }`}
          >
            対話チャット
          </button>
          <button
            onClick={() => setActiveView("defense")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeView === "defense"
                ? "bg-teal-100 text-teal-700"
                : "bg-white text-stone-400 border border-stone-200"
            }`}
          >
            弁護人AI
          </button>
        </div>
      )}

      {activeView === "defense" && showDefenseTab && myRole ? (
        <DefenseChat
          messages={defenseMessages}
          input={defenseInput}
          loading={defenseLoading}
          draftLoading={draftLoading}
          onInputChange={setDefenseInput}
          onSend={handleSendDefense}
          onGenerateDraft={handleGenerateDraft}
        />
      ) : (
        <>
          {caseData.phase === "waiting" && (
            <div className="max-w-2xl mx-auto w-full px-4 py-6">
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-8 text-center">
                <p className="text-stone-500 text-sm mb-4">相手の参加を待っています...</p>
                <button
                  onClick={copyShareLink}
                  className="bg-rose-400 hover:bg-rose-300 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
                >
                  {copied ? "✓ コピー済み" : "招待リンクをコピー"}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-3 space-y-3 overflow-y-auto">
            {timeline.map((item) => {
              if (item.type === "judge") {
                return <JudgeMessageBubble key={`judge-${item.data.id}`} message={item.data} />;
              }
              const arg = item.data;
              const isPlaintiff = arg.role === "plaintiff";
              const name = isPlaintiff ? caseData.plaintiff?.name : caseData.defendant?.name;
              const warning = myRole === arg.role ? warningMap.get(arg.id) : undefined;
              return (
                <div key={arg.id}>
                  <div className={`flex flex-col ${isPlaintiff ? "items-start" : "items-end"}`}>
                    <p className={`text-xs mb-1 px-1 ${isPlaintiff ? "text-indigo-400" : "text-rose-400"}`}>
                      {name}
                      <span className="text-stone-300 ml-1.5">
                        {PHASE_LABELS[arg.phase]}{arg.phase === "argument" && ` ${arg.round}回目`}
                      </span>
                    </p>
                    <div className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${isPlaintiff ? "bg-indigo-50 text-indigo-900 rounded-tl-sm" : "bg-rose-50 text-rose-900 rounded-tr-sm"}`}>
                      {arg.content}
                    </div>
                  </div>
                  {warning && <ContradictionWarningBubble warning={warning} />}
                </div>
              );
            })}

            {caseData.phase === "judging" && (
              <div className="flex flex-col items-center py-6">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-6 py-5 text-center max-w-xs">
                  <p className="text-2xl mb-2 animate-pulse">⚖️</p>
                  <p className="text-amber-700 font-medium text-sm">AI が審議中です</p>
                  <p className="text-amber-500 text-xs mt-1">しばらくお待ちください</p>
                  <div className="flex justify-center gap-1.5 mt-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {canSpeak && myRole && (
            <div className="bg-white border-t border-stone-100 sticky bottom-0">
              <form onSubmit={handleSubmitArgument} className="max-w-2xl mx-auto px-4 py-4 space-y-2">
                <p className="text-xs text-stone-400">
                  あなたの番です
                  <span className={`ml-1.5 font-semibold ${myRole === "plaintiff" ? "text-indigo-400" : "text-rose-400"}`}>
                    （{PHASE_LABELS[caseData.phase]}）
                  </span>
                </p>
                <textarea
                  value={argumentText}
                  onChange={(e) => setArgumentText(e.target.value)}
                  placeholder="気持ちや考えを伝えましょう..."
                  rows={3}
                  required
                  maxLength={500}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition resize-none text-sm"
                />
                <p className="text-right text-xs text-stone-400 mt-0.5">{argumentText.length}/500</p>
                {error && <p className="text-rose-500 text-xs">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !argumentText.trim()}
                  className={`w-full font-semibold py-2.5 rounded-xl transition-colors text-sm text-white disabled:bg-stone-200 disabled:text-stone-400 ${myRole === "plaintiff" ? "bg-indigo-400 hover:bg-indigo-300" : "bg-rose-400 hover:bg-rose-300"}`}
                >
                  {loading ? "送信中..." : "送る"}
                </button>
              </form>
            </div>
          )}

          {!canSpeak && myRole && !["waiting", "judging", "verdict"].includes(caseData.phase) && (
            <div className="bg-white border-t border-stone-100 sticky bottom-0">
              <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-center gap-2">
                <p className="text-stone-400 text-sm">{opponentName ?? "相手"} さんの返答を待っています</p>
                <span className="inline-flex items-center gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {draftText !== null && (
        <DraftModal
          draft={draftText}
          onSubmit={handleSubmitDraft}
          onCancel={() => setDraftText(null)}
        />
      )}
    </main>
  );
}

function PlayerChip({ name, role, isActive, isMe }: { name: string; role: Role; isActive: boolean; isMe: boolean }) {
  const isPlaintiff = role === "plaintiff";
  return (
    <div className={`flex-1 rounded-xl px-3 py-2 border transition-all ${isActive ? isPlaintiff ? "bg-indigo-50 border-indigo-200 ring-1 ring-indigo-300" : "bg-rose-50 border-rose-200 ring-1 ring-rose-300" : "bg-white border-stone-100"}`}>
      <p className={`text-xs font-medium ${isPlaintiff ? "text-indigo-400" : "text-rose-400"}`}>
        {ROLE_LABELS[role]}{isMe && <span className="text-stone-300 ml-1">（あなた）</span>}
      </p>
      <p className="text-stone-700 text-sm font-semibold">{name}</p>
    </div>
  );
}
