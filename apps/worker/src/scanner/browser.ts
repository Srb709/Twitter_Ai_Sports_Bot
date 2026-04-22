/**
 * Browser management module using playwright-extra + stealth plugin.
 * Configures a Chromium instance that mimics a real mobile browser to reduce
 * bot-detection fingerprinting on X/Twitter.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { randomDelay, sleep } from '@sports-engine/shared';

// Register stealth plugin once at module load
chromium.use(StealthPlugin() as any);

/** Realistic iPhone 13 user-agent to blend in with mobile traffic */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/17.0 Mobile/15E148 Safari/604.1';

/** Mobile viewport matching iPhone 13 / 14 dimensions */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Launch a stealth Chromium browser and return its context.
 * If a saved auth-state file exists it is loaded so that the session
 * starts pre-authenticated.
 */
export async function createBrowserContext(config: {
  authStatePath: string;
  headless: boolean;
}): Promise<BrowserContext> {
  const storageStateExists =
    fs.existsSync(config.authStatePath) &&
    fs.statSync(config.authStatePath).size > 0;

  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
    ],
  });

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent: MOBILE_USER_AGENT,
    viewport: MOBILE_VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
    },
  };

  if (storageStateExists) {
    contextOptions.storageState = config.authStatePath;
  }

  const ctx = await browser.newContext(contextOptions);

  // Override navigator.webdriver so sites cannot detect automation
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
    // Spoof plugins array to look non-empty like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
      configurable: true,
    });
    // Provide a fake notification permission that returns "denied" without prompting
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      (window.navigator.permissions as any).query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : originalQuery.call(window.navigator.permissions, parameters);
    }
  });

  return ctx;
}

/** Persist the current browser session (cookies, localStorage) to disk. */
export async function saveStorageState(
  ctx: BrowserContext,
  authStatePath: string,
): Promise<void> {
  const dir = path.dirname(authStatePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await ctx.storageState({ path: authStatePath });
  console.log(`[browser] Storage state saved → ${authStatePath}`);
}

/** Gracefully close the browser context (and its underlying browser). */
export async function closeBrowserContext(ctx: BrowserContext): Promise<void> {
  try {
    const browser = ctx.browser();
    await ctx.close();
    if (browser) {
      await browser.close();
    }
  } catch (err) {
    console.warn('[browser] Error during close:', err);
  }
}

/**
 * Open a new page within the context with realistic headers pre-set.
 * Always uses the mobile user-agent and extra headers for consistency.
 */
export async function newPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  });

  return page;
}

/**
 * Scroll the page in a human-like pattern: variable increments with random
 * pauses between each scroll step.
 */
export async function humanScroll(page: Page, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    // Scroll between 300 and 700 pixels at a time
    const scrollAmount = 300 + Math.floor(Math.random() * 400);
    await page.evaluate((amount: number) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);

    // Wait between 800ms and 2200ms between scrolls to mimic reading
    await randomDelay(800, 2200);
  }
}

/**
 * Wait for the page network to become idle (no in-flight requests for 500ms).
 * Fails silently after `timeout` ms so callers are not blocked.
 */
export async function waitForNetworkIdle(
  page: Page,
  timeout = 5000,
): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Timeout is acceptable — X is an SPA that never truly goes idle
  }
}
