import { NextResponse, type NextRequest } from 'next/server'

// Soft password gate. An httpOnly cookie is set only after the correct
// password is posted to /api/login (server-side check). Until then every
// route — the page and every image — is rewritten to the login screen.
const COOKIE = 'cl_gate'
const PASS_TOKEN = 'ok'

function withHardening(res: NextResponse): NextResponse {
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // The login endpoint must reach its route handler even when locked.
  if (pathname === '/api/login') return NextResponse.next()

  const unlocked = req.cookies.get(COOKIE)?.value === PASS_TOKEN

  if (!unlocked) {
    return withHardening(NextResponse.rewrite(new URL('/login.html', req.url)))
  }

  if (pathname === '/') {
    return withHardening(NextResponse.rewrite(new URL('/home.html', req.url)))
  }
  return withHardening(NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
