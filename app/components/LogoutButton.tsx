'use client'

import { useActionState } from 'react'
import { logout } from '@/app/actions/auth'

interface LogoutButtonProps {
  className?: string
}

export default function LogoutButton({ className }: LogoutButtonProps) {
  const [state, formAction] = useActionState(logout, null)

  return (
    <div>
      <form action={formAction}>
        <button type="submit" className={className}>
          ログアウト
        </button>
      </form>
      {state?.error && (
        <p className="text-rose-500 text-xs mt-1">{state.error}</p>
      )}
    </div>
  )
}
