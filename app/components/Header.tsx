import Link from 'next/link'
import { createSessionClient } from '@/lib/supabase/server'
import HeaderUserMenu from '@/app/components/HeaderUserMenu'

export default async function Header() {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()

  let avatarUrl: string | null = null
  let displayName: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url, display_name')
      .eq('id', user.id)
      .single()

    if (profile) {
      avatarUrl = profile.avatar_url ?? null
      displayName = profile.display_name ?? null
    }
  }

  return (
    <header className="bg-stone-50 border-b border-stone-200 sticky top-0 z-20">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-stone-800 font-semibold text-lg">
          igiari
        </Link>
        <HeaderUserMenu
          isAuthenticated={!!user}
          avatarUrl={avatarUrl}
          displayName={displayName}
        />
      </div>
    </header>
  )
}
