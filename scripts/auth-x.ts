/**
 * One-time X/Twitter login script.
 * Run: pnpm auth:x
 * Saves session to AUTH_STATE_PATH (default: auth-state/x-session.json)
 * The worker reuses this session on every run — only re-run when it expires.
 */
import "dotenv/config";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs/promises";
import readline from "readline";

chromium.use(stealth());

const AUTH_STATE_PATH = process.env.AUTH_STATE_PATH ?? "auth-state/x-session.json";
const X_URL = "https://x.com/login";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  console.log("Opening X/Twitter login page...");
  console.log("Complete the login in the browser window, then come back here.\n");

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  await page.goto(X_URL, { waitUntil: "networkidle" });

  // Auto-fill credentials if env vars are set
  const username = process.env.X_USERNAME ?? process.env.X_EMAIL ?? "";
  const password = process.env.X_PASSWORD ?? "";

  if (username && password) {
    console.log(`Auto-filling credentials for ${username}...`);
    try {
      await page.waitForSelector('input[autocomplete="username"]', { timeout: 10_000 });
      await page.fill('input[autocomplete="username"]', username);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);

      // Handle username challenge (X sometimes asks for username again)
      const usernameChallenge = await page.$('input[data-testid="ocfEnterTextTextInput"]');
      if (usernameChallenge) {
        await usernameChallenge.fill(process.env.X_USERNAME ?? username);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1500);
      }

      await page.waitForSelector('input[name="password"]', { timeout: 10_000 });
      await page.fill('input[name="password"]', password);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    } catch (err) {
      console.warn("Auto-fill failed — please log in manually in the browser window:", err);
    }
  }

  await prompt(
    '\nComplete any 2FA/captcha steps in the browser, then press ENTER here when you are logged in and see the home feed...'
  );

  // Verify we're actually logged in
  const url = page.url();
  if (!url.includes("x.com/home") && !url.includes("x.com/i/")) {
    console.warn(`Warning: Current URL is ${url}. You may not be fully logged in.`);
    const proceed = await prompt("Continue anyway? (y/n): ");
    if (proceed.toLowerCase() !== "y") {
      await browser.close();
      process.exit(1);
    }
  }

  // Save auth state
  await fs.mkdir(path.dirname(AUTH_STATE_PATH), { recursive: true });
  await context.storageState({ path: AUTH_STATE_PATH });
  await browser.close();

  console.log(`\nAuth state saved to: ${AUTH_STATE_PATH}`);
  console.log("The worker will reuse this session automatically.");
  console.log("Re-run pnpm auth:x if you ever get logged out.");
}

main().catch((err) => {
  console.error("Auth script failed:", err);
  process.exit(1);
});
