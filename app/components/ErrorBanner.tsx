'use client'

import { useState, useEffect } from 'react'

const ERROR_MESSAGES: Record<string, string> = {
  logout_failed: 'ログアウト処理でエラーが発生しました。再度お試しください。',
}

interface ErrorBannerProps {
  errorCode: string
}

export default function ErrorBanner({ errorCode }: ErrorBannerProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Cookie を削除する（表示は1度だけ）
    fetch('/api/clear-flash').catch(() => {})
  }, [])

  if (!visible) return null

  const message = ERROR_MESSAGES[errorCode] ?? 'エラーが発生しました。'

  return (
    <div className="bg-rose-50 border-b border-rose-100 px-4 py-3 flex items-center justify-between">
      <p className="text-rose-700 text-sm">{message}</p>
      <button
        onClick={() => setVisible(false)}
        className="text-rose-400 hover:text-rose-600 text-lg leading-none ml-4"
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  )
}
