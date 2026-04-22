/**
 * Human-like browser behavior simulation.
 * Every delay, scroll, and type uses randomness that mirrors real human variance.
 * Gaussian distribution = humans cluster around a mean but have natural outliers.
 * Pure Math.random() is too uniform — detectable.
 */
import type { Page } from "playwright";

// Box-Muller transform: converts uniform random to normal (Gaussian) distribution
function gaussian(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, mean + n * stdDev);
}

/** Wait a human-realistic amount of time. Mean and variance in ms. */
export async function humanDelay(meanMs: number, stdDevMs?: number): Promise<void> {
  const sd = stdDevMs ?? meanMs * 0.3;
  const ms = Math.round(gaussian(meanMs, sd));
  await new Promise((r) => setTimeout(r, Math.max(50, ms)));
}

/** Type text character by character with realistic speed variation. */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await humanDelay(300, 100);

  for (const char of text) {
    await page.keyboard.type(char);
    // Most keystrokes: 80-180ms. Occasional pause after punctuation.
    const isPunct = /[.,!? ]/.test(char);
    await humanDelay(isPunct ? 200 : 110, 40);

    // 3% chance of a brief "thinking" pause mid-sentence
    if (Math.random() < 0.03) {
      await humanDelay(600, 200);
    }
  }
}

/** Scroll down the page naturally — in chunks with pauses, not a single jump. */
export async function humanScroll(
  page: Page,
  totalPixels: number = 800,
  direction: "down" | "up" = "down"
): Promise<void> {
  const sign = direction === "down" ? 1 : -1;
  let scrolled = 0;

  while (scrolled < totalPixels) {
    const chunk = Math.round(gaussian(120, 40));
    await page.mouse.wheel(0, sign * chunk);
    scrolled += chunk;
    await humanDelay(200, 80);

    // Occasional longer pause — "reading" content
    if (Math.random() < 0.15) {
      await humanDelay(1500, 500);
    }
  }
}

/** Move mouse to an element in a natural arc, not a straight line. */
export async function humanMouseMove(page: Page, selector: string): Promise<void> {
  const el = await page.$(selector);
  if (!el) return;

  const box = await el.boundingBox();
  if (!box) return;

  const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

  // Move in several steps to simulate arc
  const steps = 8 + Math.floor(Math.random() * 6);
  const current = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Slight curve via quadratic bezier midpoint offset
    const midX = (current.x + targetX) / 2 + gaussian(0, 30);
    const midY = (current.y + targetY) / 2 + gaussian(0, 20);
    const x = (1 - t) * (1 - t) * current.x + 2 * (1 - t) * t * midX + t * t * targetX;
    const y = (1 - t) * (1 - t) * current.y + 2 * (1 - t) * t * midY + t * t * targetY;
    await page.mouse.move(Math.round(x), Math.round(y));
    await humanDelay(30, 10);
  }
}

/** Click an element like a human — move there, pause, click. */
export async function humanClick(page: Page, selector: string): Promise<void> {
  await humanMouseMove(page, selector);
  await humanDelay(120, 50);
  await page.click(selector);
}

/**
 * Organic browsing session — scroll around, pause, look at things, don't DO anything.
 * Calling this between real actions makes session behavior look human.
 */
export async function organicBrowse(page: Page, durationMs: number = 8000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    const action = Math.random();

    if (action < 0.4) {
      // Scroll down a bit
      await humanScroll(page, gaussian(400, 150));
    } else if (action < 0.55) {
      // Scroll back up a little
      await humanScroll(page, gaussian(200, 80), "up");
    } else if (action < 0.7) {
      // Idle — just reading
      await humanDelay(gaussian(2000, 600));
    } else if (action < 0.85) {
      // Move mouse to random area of screen
      const x = Math.round(50 + Math.random() * 300);
      const y = Math.round(100 + Math.random() * 600);
      await page.mouse.move(x, y);
      await humanDelay(400, 150);
    } else {
      // Short pause
      await humanDelay(gaussian(800, 300));
    }
  }
}

/** Pick a random time offset so actions don't happen at perfectly predictable intervals. */
export function jitteredInterval(baseMs: number): number {
  return Math.round(gaussian(baseMs, baseMs * 0.2));
}
