'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout(): Promise<{ error: string } | void> {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    return { error: 'ログアウトに失敗しました。もう一度お試しください。' }
  }
  redirect('/')
}
