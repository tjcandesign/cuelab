import { NextResponse, type NextRequest } from 'next/server'

// The password lives here, server-side only. It is never sent to the browser;
// clients only ever receive the login form and a yes/no via the cookie.
const PASSWORD = process.env.SITE_PASSWORD ?? 'pooltrackerapp'
const COOKIE = 'cl_gate'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const entered = String(form.get('password') ?? '')

  if (entered === PASSWORD) {
    const res = NextResponse.redirect(new URL('/', req.url), 303)
    res.cookies.set(COOKIE, 'ok', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  }

  return NextResponse.redirect(new URL('/login.html?e=1', req.url), 303)
}
