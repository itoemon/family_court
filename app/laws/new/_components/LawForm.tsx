'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

const NAME_MAX = 100;
const ARTICLE_MAX = 2000;

export default function LawForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [article, setArticle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) { setError("法律名を入力してください"); return; }
    if (name.length > NAME_MAX) { setError(`法律名は${NAME_MAX}文字以内で入力してください`); return; }
    if (article.trim().length === 0) { setError("条文を入力してください"); return; }
    if (article.length > ARTICLE_MAX) { setError(`条文は${ARTICLE_MAX}文字以内で入力してください`); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/laws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), article: article.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "法律の作成に失敗しました");
        return;
      }
      router.push(`/laws/${data.id}`);
    } catch {
      setError("法律の作成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-stone-200 rounded-xl p-6">
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          法律名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="例: 家事分担の法律"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
        />
        <p className="text-right text-xs text-stone-400 mt-1">{name.length} / {NAME_MAX}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          条文 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={article}
          onChange={e => setArticle(e.target.value)}
          maxLength={ARTICLE_MAX}
          rows={8}
          placeholder="例: 週末の掃除は交代で行う。担当者は土曜12時までに実施する。"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 resize-none"
        />
        <p className="text-right text-xs text-stone-400 mt-1">{article.length} / {ARTICLE_MAX}</p>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-50 transition-colors"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "作成中..." : "法律を作る"}
        </button>
      </div>
    </form>
  );
}
