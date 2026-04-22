/**
 * X/Twitter authentication module.
 *
 * Handles login, session validation, and session persistence so that the
 * worker can stay authenticated across restarts without requiring manual
 * intervention every time.
 */

import type { BrowserContext, Page } from 'playwright';
import { createBrowserContext, saveStorageState, newPage } from './browser.js';
import { randomDelay, sleep } from '@sports-engine/shared';
import * as fs from 'fs';

// Maximum age (ms) for a cached session before we consider it stale
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Type a string into a focused element with human-like character delays.
 * Each character is sent individually with a short random pause.
 */
async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    await randomDelay(40, 130);
  }
}

/**
 * Determine whether the current page reflects a logged-in state by checking
 * for DOM elements that only appear in an authenticated session.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    // Any of these selectors indicates the user is logged in
    const selectors = [
      'a[data-testid="AppTabBar_Home_Link"]',
      'a[data-testid="AppTabBar_DirectMessage_Link"]',
      'a[href="/home"]',
      'div[data-testid="primaryColumn"]',
    ];

    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) return true;
    }

    // Also check the URL — if we're on /home we're definitely in
    const url = page.url();
    if (url.includes('x.com/home') || url.includes('twitter.com/home')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Execute the full X login flow programmatically.
 *
 * The login UI has multiple pages:
 *   1. Enter username → Next
 *   2. (Optional) "Enter phone or email" verification step
 *   3. Enter password → Log in
 *
 * Returns true if login succeeded, false if any step failed.
 */
export async function performXLogin(
  ctx: BrowserContext,
  credentials: { username: string; email: string; password: string },
): Promise<boolean> {
  const page = await newPage(ctx);

  try {
    console.log('[auth] Navigating to X login page…');
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await randomDelay(1500, 3000);

    // ── Step 1: Username ──────────────────────────────────────────────────────
    const usernameInput = await page.waitForSelector(
      'input[autocomplete="username"], input[name="text"]',
      { timeout: 15_000 },
    );
    if (!usernameInput) {
      console.error('[auth] Could not find username input');
      return false;
    }

    await usernameInput.click();
    await randomDelay(400, 800);
    await humanType(page, credentials.username);
    await randomDelay(600, 1200);

    // Click the "Next" button
    const nextButton = await page.$(
      '[data-testid="LoginForm_Login_Button"], ' +
        'div[role="button"]:has-text("Next"), ' +
        'span:has-text("Next")',
    );
    if (nextButton) {
      await nextButton.click();
    } else {
      // Fallback: press Enter
      await page.keyboard.press('Enter');
    }

    await randomDelay(1500, 2500);

    // ── Step 2: Possible phone/email verification ─────────────────────────────
    // X sometimes asks "Enter your phone number or email address"
    const verifyInput = await page.$(
      'input[data-testid="ocfEnterTextTextInput"], ' +
        'input[name="text"][autocomplete="email"]',
    );
    if (verifyInput) {
      console.log('[auth] Phone/email verification step detected, using email…');
      await verifyInput.click();
      await randomDelay(300, 700);
      await humanType(page, credentials.email);
      await randomDelay(500, 1000);

      const verifyNext = await page.$(
        '[data-testid="ocfEnterTextNextButton"], ' +
          'div[role="button"]:has-text("Next")',
      );
      if (verifyNext) {
        await verifyNext.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await randomDelay(1500, 2500);
    }

    // ── Step 3: Password ──────────────────────────────────────────────────────
    const passwordInput = await page.waitForSelector(
      'input[name="password"], input[type="password"]',
      { timeout: 15_000 },
    );
    if (!passwordInput) {
      console.error('[auth] Could not find password input');
      return false;
    }

    await passwordInput.click();
    await randomDelay(400, 800);
    await humanType(page, credentials.password);
    await randomDelay(700, 1500);

    const loginButton = await page.$(
      '[data-testid="LoginForm_Login_Button"], ' +
        'div[role="button"]:has-text("Log in"), ' +
        'span:has-text("Log in")',
    );
    if (loginButton) {
      await loginButton.click();
    } else {
      await page.keyboard.press('Enter');
    }

    // ── Step 4: Confirm success ───────────────────────────────────────────────
    await randomDelay(3000, 5000);
    await page.waitForURL(/x\.com\/(home|i\/|notifications)/, { timeout: 20_000 }).catch(() => {});

    const loggedIn = await isAuthenticated(page);
    if (loggedIn) {
      console.log('[auth] Login successful');
    } else {
      console.error('[auth] Login may have failed — could not confirm authenticated state');
    }

    return loggedIn;
  } catch (err) {
    console.error('[auth] Login error:', err);
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Check whether the saved auth-state file is recent enough to be trusted.
 * Returns false if the file does not exist or is older than SESSION_MAX_AGE_MS.
 */
export function loadSessionFromDisk(authStatePath: string): boolean {
  if (!fs.existsSync(authStatePath)) return false;

  const stats = fs.statSync(authStatePath);
  if (stats.size === 0) return false;

  const ageMs = Date.now() - stats.mtimeMs;
  if (ageMs > SESSION_MAX_AGE_MS) {
    console.log(
      `[auth] Session file is ${Math.round(ageMs / 60_000)} min old (max ${SESSION_MAX_AGE_MS / 60_000} min) — will re-authenticate`,
    );
    return false;
  }

  return true;
}

/**
 * Top-level authentication helper.
 *
 * Attempts to reuse an existing session. If the session is missing, stale, or
 * invalid, it falls back to a fresh login. The final validated session is
 * persisted to disk so it can be reloaded on the next run.
 *
 * Returns a ready-to-use authenticated Page.
 */
export async function ensureAuthenticated(
  ctx: BrowserContext,
  authStatePath: string,
  credentials: { username: string; email: string; password: string },
): Promise<Page> {
  const sessionOnDisk = loadSessionFromDisk(authStatePath);

  // Open a page to test the current session (may already be loaded from storageState)
  const page = await newPage(ctx);

  if (sessionOnDisk) {
    console.log('[auth] Checking existing session…');
    try {
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await randomDelay(2000, 3500);

      if (await isAuthenticated(page)) {
        console.log('[auth] Existing session is valid ✓');
        return page;
      }
      console.log('[auth] Session appears expired — logging in again');
    } catch (err) {
      console.warn('[auth] Could not navigate to verify session:', err);
    }
  }

  await page.close();

  // Fresh login
  const success = await performXLogin(ctx, credentials);
  if (!success) {
    throw new Error('[auth] Authentication failed — check credentials and try again');
  }

  // Save the freshly established session
  await saveStorageState(ctx, authStatePath);

  // Return an authenticated page pointing at home
  const authedPage = await newPage(ctx);
  await authedPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await randomDelay(1500, 2500);

  return authedPage;
}
