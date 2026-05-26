"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Case } from "@/lib/types";

const PHASE_LABELS: Record<string, string> = {
  opening: "はじめのひとこと",
  argument: "主張・反論",
  closing: "最後のひとこと",
};

export default function VerdictPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setCaseId(id));
  }, [params]);

  useEffect(() => {
    if (!caseId) return;
    fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then(setCaseData);
  }, [caseId]);

  if (!caseData || !caseData.verdict) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-400 text-sm">判決を読み込み中...</p>
      </div>
    );
  }

  const { verdict } = caseData;
  const winnerName =
    verdict.winner === "plaintiff"
      ? caseData.plaintiff?.name
      : verdict.winner === "defendant"
      ? caseData.defendant?.name
      : null;

  const winnerConfig = {
    plaintiff: {
      label: "の主張が認められました",
      bg: "bg-brand-50",
      border: "border-brand-100",
      text: "text-brand-700",
      bar: "bg-brand-300",
    },
    defendant: {
      label: "の主張が認められました",
      bg: "bg-rose-50",
      border: "border-rose-100",
      text: "text-rose-700",
      bar: "bg-rose-300",
    },
    draw: {
      label: "引き分けです",
      bg: "bg-amber-50",
      border: "border-amber-100",
      text: "text-amber-700",
      bar: "bg-amber-300",
    },
  }[verdict.winner];

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-xl space-y-5">

        {/* 判決バナー */}
        <div className={`${winnerConfig.bg} border ${winnerConfig.border} rounded-3xl p-8 text-center`}>
          <div className="text-4xl mb-4">⚖️</div>
          <p className="text-xs text-stone-400 uppercase tracking-wider mb-2">判決</p>
          {winnerName ? (
            <p className={`text-2xl font-bold ${winnerConfig.text}`}>
              {winnerName}
              <span className="text-stone-500 font-normal text-lg ml-1">
                {winnerConfig.label}
              </span>
            </p>
          ) : (
            <p className={`text-2xl font-bold ${winnerConfig.text}`}>{winnerConfig.label}</p>
          )}
          <p className="text-stone-600 text-sm mt-4 leading-relaxed">{verdict.summary}</p>
        </div>

        {/* テーマ */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-6 py-4">
          <p className="text-xs text-stone-400 mb-1">テーマ</p>
          <p className="text-stone-700 font-medium">{caseData.topic}</p>
        </div>

        {/* スコア */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">説得力スコア</p>
          <div className="space-y-4">
            <ScoreBar
              label={caseData.plaintiff?.name ?? "提案者"}
              score={verdict.plaintiffScore}
              color="bg-brand-300"
              textColor="text-brand-600"
            />
            <ScoreBar
              label={caseData.defendant?.name ?? "反対者"}
              score={verdict.defendantScore}
              color="bg-rose-300"
              textColor="text-rose-500"
            />
          </div>
        </div>

        {/* 判決理由 */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">AI の所見</p>
          <p className="text-stone-600 text-sm leading-7 whitespace-pre-wrap">{verdict.reasoning}</p>
        </div>

        {/* やりとりの記録 */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">やりとりの記録</p>
          <div className="space-y-4">
            {caseData.arguments.map((arg) => {
              const isPlaintiff = arg.role === "plaintiff";
              const name = isPlaintiff ? caseData.plaintiff?.name : caseData.defendant?.name;
              return (
                <div key={arg.id} className={`flex flex-col ${isPlaintiff ? "items-start" : "items-end"}`}>
                  <p className={`text-xs mb-1 px-1 ${isPlaintiff ? "text-brand-600" : "text-rose-400"}`}>
                    {name}
                    <span className="text-stone-300 ml-1.5">
                      {PHASE_LABELS[arg.phase]}
                      {arg.phase === "argument" && ` ${arg.round}回目`}
                    </span>
                  </p>
                  <div
                    className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      isPlaintiff
                        ? "bg-brand-50 text-brand-900 rounded-tl-sm"
                        : "bg-rose-50 text-rose-900 rounded-tr-sm"
                    }`}
                  >
                    {arg.content}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => router.push("/")}
          className="w-full bg-white hover:bg-stone-50 border border-stone-200 text-stone-600 font-medium py-3 rounded-2xl transition-colors text-sm shadow-sm"
        >
          あたらしい話し合いをはじめる
        </button>
      </div>
    </main>
  );
}

function ScoreBar({
  label,
  score,
  color,
  textColor,
}: {
  label: string;
  score: number;
  color: string;
  textColor: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className={`font-medium ${textColor}`}>{label}</span>
        <span className="text-stone-400">{score}点</span>
      </div>
      <div className="w-full bg-stone-100 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
