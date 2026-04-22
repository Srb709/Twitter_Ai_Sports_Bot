import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'sce-session';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Allow public paths through without any auth check
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
  if (isPublic) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE);
  const password = process.env.APP_PASSWORD;

  // If no password configured, allow through (misconfiguration — fail open so
  // the developer can at least see the app)
  if (!password) {
    return NextResponse.next();
  }

  if (!session || session.value !== password) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (static files)
     *  - _next/image   (image optimisation)
     *  - favicon.ico
     *  - /icons/*      (PWA icons)
     *  - manifest.json (PWA manifest)
     */
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)',
  ],
};
