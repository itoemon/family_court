import Link from 'next/link'
import { createSessionClient } from '@/lib/supabase/server'
import LogoutButton from '@/app/components/LogoutButton'

export default async function Header() {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <header className="bg-stone-50 border-b border-stone-200">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-stone-800 font-semibold text-lg">
          家庭裁判所
        </Link>
        {user ? (
          <nav className="flex items-center gap-4">
            <Link href="/profile" className="text-stone-600 hover:text-stone-900 transition-colors">
              プロフィール
            </Link>
            <LogoutButton className="text-stone-500 hover:text-stone-700 text-sm" />
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
