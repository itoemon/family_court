import Link from 'next/link'
import { createSessionClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'

export default async function Header() {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()

  async function handleLogout() {
    'use server'
    await logout()
  }

  return (
    <header className="bg-stone-50 border-b border-stone-200 sticky top-0 z-20">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-stone-800 font-semibold text-lg">
          家庭裁判所
        </Link>
        {user ? (
          <nav className="flex items-center gap-4">
            <Link href="/history" className="text-stone-600 hover:text-stone-900 transition-colors">
              過去のケース
            </Link>
            <Link href="/profile" className="text-stone-600 hover:text-stone-900 transition-colors">
              プロフィール
            </Link>
            <form action={handleLogout}>
              <button type="submit" className="text-stone-500 hover:text-stone-700 text-sm">
                ログアウト
              </button>
            </form>
          </nav>
        ) : (
          <nav className="flex items-center gap-4">
            <Link href="/auth/login" className="text-stone-600 hover:text-stone-900 transition-colors">
              ログイン
            </Link>
            <Link href="/auth/signup" className="text-stone-600 hover:text-stone-900 transition-colors">
              サインアップ
            </Link>
          </nav>
        )}
      </div>
    </header>
  )
}
