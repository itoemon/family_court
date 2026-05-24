import { DefenseMessage } from "@/lib/types";

interface DefenseChatProps {
  messages: DefenseMessage[];
  input: string;
  loading: boolean;
  draftLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: (e: { preventDefault(): void }) => void;
  onGenerateDraft: () => void;
}

export default function DefenseChat({
  messages,
  input,
  loading,
  draftLoading,
  onInputChange,
  onSend,
  onGenerateDraft,
}: DefenseChatProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-3 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex justify-center pt-8">
            <p className="text-stone-400 text-sm text-center max-w-xs">
              弁護人AIに気持ちや事情を話してみましょう。あなたの主張を整理するお手伝いをします。
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
          >
            <p className={`text-xs mb-1 px-1 ${m.role === "user" ? "text-stone-400" : "text-teal-500"}`}>
              {m.role === "user" ? "あなた" : "弁護人AI"}
            </p>
            <div
              className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                m.role === "user"
                  ? "bg-stone-100 text-stone-800 rounded-tr-sm"
                  : "bg-teal-50 text-teal-900 rounded-tl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border-t border-stone-100 sticky bottom-0">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-1">
          <button
            type="button"
            onClick={onGenerateDraft}
            disabled={draftLoading || messages.length === 0}
            className="w-full py-2 rounded-xl text-sm font-medium bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 disabled:bg-stone-50 disabled:text-stone-300 disabled:border-stone-200 transition-colors"
          >
            {draftLoading ? "生成中..." : "回答案を作成する"}
          </button>
        </div>
        <form onSubmit={onSend} className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="弁護人AIに話しかけてみましょう..."
            rows={3}
            maxLength={1000}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-transparent transition resize-none text-sm"
          />
          <p className="text-right text-xs text-stone-400">{input.length}/1000</p>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full font-semibold py-2.5 rounded-xl transition-colors text-sm text-white bg-teal-400 hover:bg-teal-300 disabled:bg-stone-200 disabled:text-stone-400"
          >
            {loading ? "送信中..." : "送る"}
          </button>
        </form>
      </div>
    </div>
  );
}
