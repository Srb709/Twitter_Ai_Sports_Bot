import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const SESSION_COOKIE = 'sce-session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Returns true if the current request carries a valid session cookie.
 * Call this from Server Components or Route Handlers (server-side only).
 */
export function isAuthenticated(): boolean {
  const cookieStore = cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  return session?.value === password;
}

/**
 * Redirects to /login if the caller is not authenticated.
 * Use at the top of any protected Server Component.
 */
export function checkAuth(): void {
  if (!isAuthenticated()) {
    redirect('/login');
  }
}

/**
 * Returns the expected session value (the raw APP_PASSWORD).
 * Used by the auth API route to set the cookie after validating the submitted password.
 */
export function getPasswordHash(): string {
  return process.env.APP_PASSWORD ?? '';
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
