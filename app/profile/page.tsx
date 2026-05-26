"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LogoutButton from "@/app/components/LogoutButton";

export default function ProfilePage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customInstruction, setCustomInstruction] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [customIsError, setCustomIsError] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, api_key_encrypted, avatar_url, defense_custom_instruction")
        .eq("id", user.id)
        .single();

      if (profile) {
        setDisplayName(profile.display_name);
        setHasApiKey(!!profile.api_key_encrypted);
        setAvatarUrl(profile.avatar_url ?? null);
        setCustomInstruction(profile.defense_custom_instruction ?? "");
      }
      setLoading(false);
    }
    load();
  }, [supabase, router]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>) {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "保存に失敗しました");
      }
      const data = await res.json();
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("JPEG・PNG・WebP のみ対応しています");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("ファイルサイズは2MB以下にしてください");
      e.target.value = "";
      return;
    }

    setAvatarError("");
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "アップロードに失敗しました");
      }
      const data = await res.json();
      setAvatarUrl(data.avatar_url);
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : "アップロード中にエラーが発生しました");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleSaveCustomInstruction() {
    setSavingCustom(true);
    setCustomMessage("");
    setCustomIsError(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defenseCustomInstruction: customInstruction }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "保存に失敗しました");
      }
      setCustomMessage("保存しました");
    } catch (err: unknown) {
      setCustomIsError(true);
      setCustomMessage(err instanceof Error ? err.message : "保存中にエラーが発生しました");
    } finally {
      setSavingCustom(false);
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
          <div className="relative inline-block mb-4">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="アバター"
                width={56}
                height={56}
                className="rounded-2xl object-cover"
              />
            ) : (
              <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-100 rounded-2xl text-2xl">
                {displayName ? displayName[0].toUpperCase() : "?"}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 bg-white border border-stone-200 rounded-full w-6 h-6 flex items-center justify-center text-xs cursor-pointer hover:bg-stone-50 transition disabled:opacity-50"
              aria-label="アバター画像を変更"
            >
              📷
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
            disabled={uploading}
          />
          {uploading && (
            <p className="text-xs text-stone-400 mb-1">アップロード中...</p>
          )}
          {avatarError && (
            <p className="text-xs text-rose-500 mb-1">{avatarError}</p>
          )}
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
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm"
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
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm"
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
              className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          </form>

          <div className="pt-5 border-t border-stone-100 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                弁護人AIへの指示（任意）
              </label>
              <textarea
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="例：やさしい言葉で話してほしい"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition text-sm resize-none"
              />
              <p className="text-xs text-stone-400 text-right mt-1">
                残り {Math.max(0, 200 - customInstruction.length)} 文字
              </p>
              <p className="text-xs text-stone-400">
                弁護人AIのシステムプロンプト末尾に付加されます。
              </p>
            </div>

            {customMessage && (
              <p className={`text-sm rounded-xl px-4 py-2 ${customIsError ? "text-rose-500 bg-rose-50 border border-rose-100" : "text-emerald-600 bg-emerald-50 border border-emerald-100"}`}>
                {customMessage}
              </p>
            )}

            <button
              type="button"
              onClick={handleSaveCustomInstruction}
              disabled={savingCustom}
              className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              {savingCustom ? "保存中..." : "AIへの指示を保存"}
            </button>
          </div>

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
