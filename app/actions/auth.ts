'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout(): Promise<void> {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) console.error('signOut error:', error)
  redirect('/')
}
