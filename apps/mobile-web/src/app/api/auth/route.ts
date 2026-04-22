import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'sce-session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { password } = body;
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    // APP_PASSWORD not configured — reject all attempts
    return NextResponse.json(
      { error: 'Auth not configured' },
      { status: 500 },
    );
  }

  if (!password || password !== appPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Set the session cookie
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, appPassword, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(): Promise<NextResponse> {
  const cookieStore = cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true }, { status: 200 });
}
