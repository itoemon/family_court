'use client'

import { logout } from '@/app/actions/auth'

interface LogoutButtonProps {
  className?: string
}

export default function LogoutButton({ className }: LogoutButtonProps) {
  return (
    <form action={logout}>
      <button type="submit" className={className}>
        ログアウト
      </button>
    </form>
  )
}
