'use client';

import { useEffect, useRef, useState } from "react";
import type { PublicLawListItem } from "@/lib/types";
import PublicLawCard from "./PublicLawCard";

interface Props {
  initialLaws: PublicLawListItem[];
  initialQuery: string;
}

// 検索ボックス + 結果差し替え。初期表示は SSR 済みの initialLaws、
// 以降の絞り込みは debounce して GET /api/laws/public?q=... を fetch する（設計 (B)）。
export default function HubSearch({ initialLaws, initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [laws, setLaws] = useState<PublicLawListItem[]>(initialLaws);
  const [error, setError] = useState<string | null>(null);
  // 初回マウント時は SSR 結果をそのまま使い、無駄な再取得をしない。
  const initialQueryRef = useRef(initialQuery);

  useEffect(() => {
    if (query === initialQueryRef.current) return;

    const handle = setTimeout(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/laws/public?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "検索に失敗しました");
          return;
        }
        setLaws(data);
      } catch {
        setError("検索に失敗しました");
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="法律名で検索"
        maxLength={100}
        className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {laws.length === 0 ? (
        <div className="text-center py-16 text-stone-400">
          <p className="text-lg">公開されている法律がありません</p>
          <p className="text-sm mt-1">条件を変えて検索してみましょう</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {laws.map(law => (
            <PublicLawCard key={law.id} law={law} />
          ))}
        </ul>
      )}
    </div>
  );
}
