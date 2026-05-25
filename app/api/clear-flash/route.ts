import { NextResponse } from 'next/server'

export async function GET() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('flash_error', '', { path: '/', maxAge: 0, httpOnly: true })
  return res
}
