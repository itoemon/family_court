"use client";

import { useState } from "react";

interface DraftModalProps {
  draft: string;
  onSubmit: (finalText: string) => void;
  onCancel: () => void;
}

export default function DraftModal({ draft, onSubmit, onCancel }: DraftModalProps) {
  const [editedText, setEditedText] = useState(draft);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-stone-800">回答案</h2>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          rows={5}
          maxLength={500}
          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-teal-300 focus:border-transparent transition resize-none text-sm"
        />
        <p className="text-right text-xs text-stone-400">{editedText.length}/500</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-500 text-sm font-medium hover:bg-stone-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onSubmit(editedText)}
            disabled={!editedText.trim()}
            className="flex-1 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:bg-stone-200 disabled:text-stone-400 text-white text-sm font-semibold transition-colors"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
