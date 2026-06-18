'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  lawId: string;
}

// 公開法律を純クローンでインポートし、成功時に新規法律の詳細へ遷移する。
export default function ImportButton({ lawId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/laws/${lawId}/import`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "インポートに失敗しました"); return; }
      router.push(`/laws/${data.id}`);
    } catch {
      setError("インポートに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleImport}
        disabled={loading}
        className="px-4 py-2 bg-brand-700 text-white text-sm rounded-lg hover:bg-brand-800 transition-colors disabled:opacity-50"
      >
        {loading ? "インポート中..." : "インポート"}
      </button>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
