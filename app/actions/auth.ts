'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export async function logout(): Promise<void> {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('signOut error:', error)
    const cookieStore = await cookies()
    cookieStore.set('flash_error', 'logout_failed', {
      path: '/',
      httpOnly: true,
      maxAge: 30,
    })
  }
  redirect('/')
}
