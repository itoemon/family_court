'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  lawId: string;
  isPublic: boolean;
}

// オーナー向けの Hub 公開トグル。現在の公開状態を表示し ON/OFF を切り替える。
export default function VisibilityToggle({ lawId, isPublic }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: !isPublic }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "公開設定の変更に失敗しました"); return; }
      router.refresh();
    } catch {
      setError("公開設定の変更に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-stone-800">Hub 公開</h2>
          <p className="text-sm text-stone-500 mt-1">
            {isPublic
              ? "この法律は Hub で全ユーザーに公開されています。"
              : "この法律は公開されていません（メンバーのみ閲覧可）。"}
          </p>
        </div>
        <span className={`shrink-0 px-2 py-1 text-xs rounded-full font-medium ${
          isPublic ? "bg-brand-100 text-brand-800" : "bg-stone-100 text-stone-500"
        }`}>
          {isPublic ? "公開中" : "非公開"}
        </span>
      </div>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
          isPublic
            ? "border border-stone-300 text-stone-700 hover:bg-stone-50"
            : "bg-brand-700 text-white hover:bg-brand-800"
        }`}
      >
        {loading ? "変更中..." : isPublic ? "非公開にする" : "Hub に公開する"}
      </button>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
