'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout() {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('ログアウト失敗:', error.message)
  }
  redirect('/')
}
