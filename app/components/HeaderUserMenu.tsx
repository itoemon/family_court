'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { logout } from '@/app/actions/auth'

type HeaderUserMenuProps = {
  isAuthenticated: boolean
  avatarUrl: string | null
  displayName: string | null
}

function UserSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5C5 16.91 8.13 14 12 14s7 2.91 7 6.5v.5H5v-.5Z"
      />
    </svg>
  )
}

export default function HeaderUserMenu({
  isAuthenticated,
  avatarUrl,
  displayName,
}: HeaderUserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const close = () => setIsOpen(false)

  const triggerLabel = isAuthenticated
    ? 'アカウントメニューを開く'
    : 'メニューを開く'

  const avatarWrapBase =
    'w-8 h-8 rounded-full overflow-hidden flex items-center justify-center'
  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50'

  let avatarContent: React.ReactNode
  if (isAuthenticated && avatarUrl) {
    avatarContent = (
      <span className={`${avatarWrapBase} bg-stone-100`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt={displayName ?? ''}
          width={32}
          height={32}
          className="w-full h-full object-cover"
        />
      </span>
    )
  } else if (isAuthenticated) {
    avatarContent = (
      <span className={`${avatarWrapBase} bg-stone-200`}>
        <UserSilhouette className="w-5 h-5 text-stone-600" />
      </span>
    )
  } else {
    avatarContent = (
      <span className={`${avatarWrapBase} bg-stone-100`}>
        <UserSilhouette className="w-5 h-5 text-stone-500" />
      </span>
    )
  }

  const menuItemClass =
    'block w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:bg-stone-100 focus-visible:text-stone-900'

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`rounded-full ${focusRing}`}
      >
        {avatarContent}
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 mt-2 w-48 bg-stone-50 border border-stone-200 rounded-md shadow-md py-1 z-30"
        >
          {isAuthenticated ? (
            <>
              <Link
                href="/me"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                マイページ
              </Link>
              <Link
                href="/history"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                過去のケース
              </Link>
              <Link
                href="/friends"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                フレンド
              </Link>
              <Link
                href="/profile"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                プロフィール
              </Link>
              <div role="separator" className="my-1 border-t border-stone-200" />
              <form action={logout} onSubmit={close} role="none">
                <button
                  type="submit"
                  role="menuitem"
                  className={menuItemClass}
                >
                  ログアウト
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                ログイン
              </Link>
              <Link
                href="/auth/signup"
                role="menuitem"
                onClick={close}
                className={menuItemClass}
              >
                サインアップ
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
