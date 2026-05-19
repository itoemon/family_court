'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout() {
  const supabase = await createSessionClient()
  await supabase.auth.signOut()
  redirect('/')
}
