"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Case, Role, Argument, JudgeMessage, DefenseMessage } from "@/lib/types";
import JudgeMessageBubble from "@/app/components/JudgeMessageBubble";
import ContradictionWarningBubble from "@/app/components/ContradictionWarningBubble";
import DefenseChat from "@/app/components/DefenseChat";
import DraftModal from "@/app/components/DraftModal";

const PHASE_LABELS: Record<string, string> = {
  waiting: "相手の参加を待っています",
  opening: "はじめのひとこと",
  argument: "主張・反論",
  closing: "最後のひとこと",
  extension_voting: "もう少し話し合うか確認中",
  judging: "AI が審議中...",
  verdict: "判決済み",
};

const ROLE_LABELS: Record<Role, string> = {
  plaintiff: "提案者",
  defendant: "反対者",
};

export default function CaseRoom({ caseId }: { caseId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const [caseData, setCaseData] = useState<Case | null>(null);
  // URL の ?role=plaintiff を初期値として 1 度だけ参照（マウント時のみ）。
  // 以降の変更は join ハンドラからの setMyRole 経由。
  const [myRole, setMyRole] = useState<Role | null>(() =>
    searchParams.get("role") === "plaintiff" ? "plaintiff" : null
  );
  const [joinName, setJoinName] = useState("");
  const [joinMode, setJoinMode] = useState<"choose" | "guest" | "login">("choose");
  const [argumentText, setArgumentText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // 判決リクエストの多重発火ガード。
  // state にすることで失敗時 setRequestingVerdict(false) → effect 再実行 → リトライが
  // 成立する設計（polling で phase=judging のまま卡らせないため）。同期 setState in
  // effect は意図的（effect 再実行をトリガとして使う）。
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

  // FEAT-006: 終了提案 / 延長投票の in-flight ガード
  const [endProposalInFlight, setEndProposalInFlight] = useState(false);
  const [extensionVoteInFlight, setExtensionVoteInFlight] = useState(false);

  const roleParam = searchParams.get("role") as Role | null;

  useEffect(() => {
    if (roleParam === "plaintiff") return;
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
    try {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) return;
      const data: Case = await res.json();
      setCaseData(data);
      if (data.phase === "verdict") router.push(`/case/${caseId}/verdict`);
    } catch { /* ignore polling errors */ }
  }, [caseId, router]);

  useEffect(() => {
    // fetchCase は内部で await 後に setCaseData → setState は同期 cascading にはならない。
    // react-hooks/set-state-in-effect は call site で保守的に flag するため意図を明示して disable。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCase();
    const interval = setInterval(fetchCase, 2000);
    return () => clearInterval(interval);
  }, [fetchCase]);

  useEffect(() => {
    if (caseData?.phase === "judging" && !requestingVerdict) {
      // ガードを立てる setRequestingVerdict は本効果の再実行（リトライ機会）を
      // 成立させるための意図的な同期 setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRequestingVerdict(true);
      fetch(`/api/cases/${caseId}/verdict`, { method: "POST" })
        .then(async (res) => {
          // fetch は 4xx/5xx で reject しないので res.ok を明示確認。
          // 非 2xx ならガードを解除して次の polling で再試行可能にする。
          if (!res.ok) {
            setRequestingVerdict(false);
            return;
          }
          await fetchCase();
        })
        .catch(() => setRequestingVerdict(false));
    }
  }, [caseData?.phase, caseId, fetchCase, requestingVerdict]);

  useEffect(() => {
    const count = (caseData?.arguments?.length ?? 0) + (caseData?.judgeMessages?.length ?? 0);
    if (count === 0) return;
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
      // 参加前の defense API は権限なしで 401/403 を返して showDefenseTab=false の
      // ままだったため、参加直後に明示的に再 fetch して弁護人 AI タブを出す
      // (BUG-004: リロードしないと現れない問題の修正)。
      await fetchDefenseMessages();
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
      // BUG-004: ゲスト経路も同じ理由で参加直後に再 fetch が必要。
      // 参加前は defendant_guest_name が NULL + guest cookie 未発行で 401 が
      // 返り showDefenseTab=false に倒れていた。
      await fetchDefenseMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function submitArgument(content: string) {
    if (!myRole || !content.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/argument`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
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

  async function handleSubmitArgument(e: { preventDefault(): void }) {
    e.preventDefault();
    await submitArgument(argumentText);
  }

  function copyShareLink() {
    const url = `${window.location.origin}/case/${caseId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fetchDefenseMessages = useCallback(async () => {
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
    // マウント時の初回 fetch のみ担当。参加成功直後の再 fetch は
    // handleJoinAsAccount / handleJoinAsGuest 側で明示呼び出ししているため、
    // ここでの呼び出しは純粋な初期化だけになり set-state-in-effect は発火しない。
    fetchDefenseMessages();
  }, [fetchDefenseMessages]);

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

  async function handleSubmitDraft(finalText: string) {
    setDraftText(null);
    setActiveView("dialog");
    await submitArgument(finalText);
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
            <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-100 rounded-2xl mb-4 text-2xl">⚖️</div>
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
                className="w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
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
                className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {loading ? "参加中..." : "ログインして参加する"}
              </button>
              <p className="text-center text-xs text-stone-400">
                アカウントをお持ちでない方は
                <Link href={`/auth/signup`} className="text-brand-600 font-semibold ml-1">新規登録</Link>
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
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm"
                />
              </div>
              {error && <p className="text-rose-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
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
  // FEAT-006 補正: opening / closing は cases.phase に乗らない設計だが、念のため除外。
  const canSpeak =
    isMyTurn &&
    !["waiting", "opening", "closing", "extension_voting", "judging", "verdict"].includes(
      caseData.phase
    );
  const opponentName = myRole === "plaintiff" ? caseData.defendant?.name : caseData.plaintiff?.name;
  const warningMap = new Map(
    (caseData.contradictionWarnings ?? []).map((w) => [w.argumentId, w])
  );

  // FEAT-006: 終了提案 / 延長投票の自分側状態算出
  const endProposedBy = caseData.endProposedBy;
  const isMyEndProposal =
    !!endProposedBy &&
    ((myRole === "plaintiff" && endProposedBy === "plaintiff") ||
      (myRole === "defendant" && (endProposedBy === "defendant" || endProposedBy === "guest")));
  const isOpponentEndProposal = !!endProposedBy && !isMyEndProposal && !!myRole;

  const myExtensionVote =
    myRole === "plaintiff"
      ? caseData.extensionVotePlaintiff
      : myRole === "defendant"
      ? caseData.extensionVoteDefendant
      : null;
  const opponentExtensionVote =
    myRole === "plaintiff"
      ? caseData.extensionVoteDefendant
      : myRole === "defendant"
      ? caseData.extensionVotePlaintiff
      : null;

  // 提案 / 撤回 / 同意トグル（API 1 本でサーバ側分岐）
  async function handleToggleEndProposal() {
    if (!myRole || endProposalInFlight) return;
    setEndProposalInFlight(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/end-proposal`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setEndProposalInFlight(false);
    }
  }

  async function handleExtensionVote(vote: "continue" | "finish") {
    if (!myRole || extensionVoteInFlight) return;
    setExtensionVoteInFlight(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/extension-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setExtensionVoteInFlight(false);
    }
  }

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

      {isOpponentEndProposal && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-2">
          <div className="bg-stone-100 border border-stone-300 text-stone-700 rounded-xl px-4 py-3 flex flex-col gap-2">
            <p className="text-sm">
              {opponentName ?? "相手"}さんが話し合いの終了を提案しています。
            </p>
            <button
              onClick={handleToggleEndProposal}
              disabled={endProposalInFlight}
              className="bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {endProposalInFlight ? "送信中..." : "同意して終了"}
            </button>
          </div>
        </div>
      )}

      {isMyEndProposal && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-2">
          <p className="text-xs text-stone-600 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2">
            あなたが終了を提案中です。相手の同意で判決へ進みます。撤回するには下のアイコンをもう一度押してください。
          </p>
        </div>
      )}

      {showDefenseTab && myRole && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-3 flex gap-2">
          <button
            onClick={() => setActiveView("dialog")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeView === "dialog"
                ? "bg-brand-100 text-brand-700"
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
                  className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
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
              const greetingLabel = arg.isGreeting
                ? arg.phase === "closing"
                  ? "終了の挨拶"
                  : "開始の挨拶"
                : null;
              return (
                <div key={arg.id}>
                  <div className={`flex flex-col ${isPlaintiff ? "items-start" : "items-end"}`}>
                    <p className={`text-xs mb-1 px-1 ${isPlaintiff ? "text-brand-600" : "text-rose-400"}`}>
                      {name}
                      <span className="text-stone-300 ml-1.5">
                        {greetingLabel ?? (
                          <>
                            {PHASE_LABELS[arg.phase]}
                            {arg.phase === "argument" && ` ${arg.round}回目`}
                          </>
                        )}
                      </span>
                    </p>
                    <div className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${isPlaintiff ? "bg-brand-50 text-brand-900 rounded-tl-sm" : "bg-rose-50 text-rose-900 rounded-tr-sm"}`}>
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
                <div className="flex items-center justify-between">
                  <p className="text-xs text-stone-400">
                    あなたの番です
                    <span className={`ml-1.5 font-semibold ${myRole === "plaintiff" ? "text-brand-600" : "text-rose-400"}`}>
                      （{PHASE_LABELS[caseData.phase]}）
                    </span>
                  </p>
                  {caseData.phase === "argument" && (
                    <EndProposalButton
                      active={isMyEndProposal}
                      disabled={endProposalInFlight}
                      onClick={handleToggleEndProposal}
                    />
                  )}
                </div>
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
                  className={`w-full font-semibold py-2.5 rounded-xl transition-colors text-sm text-white disabled:bg-stone-200 disabled:text-stone-400 ${myRole === "plaintiff" ? "bg-brand-700 hover:bg-brand-800" : "bg-rose-400 hover:bg-rose-300"}`}
                >
                  {loading ? "送信中..." : "送る"}
                </button>
              </form>
            </div>
          )}

          {!canSpeak && myRole && !["waiting", "opening", "closing", "extension_voting", "judging", "verdict"].includes(caseData.phase) && (
            <div className="bg-white border-t border-stone-100 sticky bottom-0">
              <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-stone-400 text-sm truncate">{opponentName ?? "相手"} さんの返答を待っています</p>
                  <span className="inline-flex items-center gap-0.5 shrink-0">
                    <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
                {caseData.phase === "argument" && (
                  <EndProposalButton
                    active={isMyEndProposal}
                    disabled={endProposalInFlight}
                    onClick={handleToggleEndProposal}
                  />
                )}
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

      {caseData.phase === "extension_voting" && myRole && (
        <ExtensionVotingModal
          myVote={myExtensionVote}
          opponentVote={opponentExtensionVote}
          disabled={extensionVoteInFlight}
          onVote={handleExtensionVote}
        />
      )}
    </main>
  );
}

function EndProposalButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? "終了の提案を取り下げる" : "話し合いの終了を提案する"}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? "bg-stone-200 text-stone-800"
          : "bg-stone-100 hover:bg-stone-200 text-stone-600"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="13" height="18" rx="1" />
        <path d="M16 12h6" />
        <path d="M19 9l3 3-3 3" />
      </svg>
      {active ? "提案を取り下げる" : "終了を提案"}
    </button>
  );
}

function ExtensionVotingModal({
  myVote,
  opponentVote,
  disabled,
  onVote,
}: {
  myVote: "continue" | "finish" | null;
  opponentVote: "continue" | "finish" | null;
  disabled: boolean;
  onVote: (vote: "continue" | "finish") => void;
}) {
  const voted = myVote !== null;
  return (
    <div className="fixed inset-0 z-30 bg-stone-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-stone-100 max-w-sm w-full p-6 space-y-4">
        <div className="text-center">
          <p className="text-2xl mb-2">🌿</p>
          <h2 className="text-lg font-bold text-stone-800">話し合いを続けますか？</h2>
        </div>
        {voted ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600 leading-relaxed">
              あなたの判断は
              <span className="font-semibold mx-1 text-stone-800">
                「{myVote === "continue" ? "続ける" : "終わる"}」
              </span>
              でした。{opponentVote === null ? "相手の投票を待っています…" : "結果を反映中です…"}
            </p>
            <p className="text-xs text-stone-400 text-center">一度選んだ判断は取り消せません</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-stone-600 leading-relaxed">
              ここまでの議論が終わりました。もう少し話し合いたい場合は「続ける」、ここで判決に進む場合は「終わる」を選んでください。一度選ぶと取り消せません。
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => onVote("continue")}
                disabled={disabled}
                className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                続ける（+3 回）
              </button>
              <button
                type="button"
                onClick={() => onVote("finish")}
                disabled={disabled}
                className="w-full bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 text-stone-700 font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                終わる（判決へ）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlayerChip({ name, role, isActive, isMe }: { name: string; role: Role; isActive: boolean; isMe: boolean }) {
  const isPlaintiff = role === "plaintiff";
  return (
    <div className={`flex-1 rounded-xl px-3 py-2 border transition-all ${isActive ? isPlaintiff ? "bg-brand-50 border-brand-200 ring-1 ring-brand-300" : "bg-rose-50 border-rose-200 ring-1 ring-rose-300" : "bg-white border-stone-100"}`}>
      <p className={`text-xs font-medium ${isPlaintiff ? "text-brand-600" : "text-rose-400"}`}>
        {ROLE_LABELS[role]}{isMe && <span className="text-stone-300 ml-1">（あなた）</span>}
      </p>
      <p className="text-stone-700 text-sm font-semibold">{name}</p>
    </div>
  );
}
