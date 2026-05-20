"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LogoutButton from "@/app/components/LogoutButton";

export default function ProfilePage() {
  const router = useRouter();
  const supabase = createClient();

  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, api_key_encrypted")
        .eq("id", user.id)
        .single();

      if (profile) {
        setDisplayName(profile.display_name);
        setHasApiKey(!!profile.api_key_encrypted);
      }
      setLoading(false);
    }
    load();
  }, [supabase, router]);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
      setHasApiKey(data.hasApiKey);
      setApiKey("");
      setMessage("保存しました");
    } catch (err: unknown) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "保存中にエラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-rose-100 rounded-2xl mb-4 text-2xl">
            👤
          </div>
          <h1 className="text-2xl font-bold text-stone-800">プロフィール</h1>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-7 space-y-5">
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                表示名
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                AI API キー
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? "登録済み（変更する場合のみ入力）" : "sk-ant-... を入力"}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent transition text-sm"
              />
              <p className="text-xs text-stone-400 mt-1.5">
                話し合いのAI裁判官に使用されます。キーはサーバーで暗号化して保存します。
                登録時はキーの有効性確認のため、軽微なテストリクエストを送信します。
              </p>
            </div>

            {message && (
              <p className={`text-sm rounded-xl px-4 py-2 ${isError ? "text-rose-500 bg-rose-50 border border-rose-100" : "text-emerald-600 bg-emerald-50 border border-emerald-100"}`}>
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-rose-400 hover:bg-rose-300 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          </form>

          <div className="pt-2 border-t border-stone-100">
            <LogoutButton className="w-full text-stone-400 hover:text-stone-600 text-sm py-2 transition-colors" />
          </div>
        </div>

        <button
          onClick={() => router.push("/")}
          className="w-full mt-3 text-stone-400 hover:text-stone-600 text-sm py-2 transition-colors"
        >
          ← 話し合いに戻る
        </button>
      </div>
    </main>
  );
}
