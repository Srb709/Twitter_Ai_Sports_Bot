/**
 * Posts approved tweet drafts by actually typing into the X compose box.
 * No API — just Playwright navigating the real Twitter UI.
 * Picks optimal posting windows: 11am-1pm and 6pm-9pm local time get best reach.
 * Adds random offset so posts never land on the exact same minute every day.
 */
import type { Page } from "playwright";
import { db } from "@sports-engine/db";
import { canAct, recordAction } from "./action-budget.js";
import { humanType, humanClick, humanDelay, organicBrowse } from "./human-behavior.js";

// Best engagement windows (hour ranges in local time)
const GOOD_HOURS = [
  [11, 13], // 11am–1pm
  [18, 21], // 6pm–9pm
];

export async function runAutoPoster(page: Page): Promise<number> {
  if (!isGoodPostingTime()) {
    console.log("[poster] Outside optimal posting window — skipping");
    return 0;
  }

  if (!(await canAct("POST"))) {
    console.log("[poster] Daily post budget exhausted");
    return 0;
  }

  // Get the oldest approved draft that hasn't been posted yet
  const draft = await db.tweetDraft.findFirst({
    where: { status: "APPROVED" },
    orderBy: { updatedAt: "asc" },
  });

  if (!draft) {
    console.log("[poster] No approved drafts to post");
    return 0;
  }

  console.log(`[poster] Posting draft ${draft.id} (${draft.tweetType})`);

  try {
    await page.goto("https://x.com/home", { waitUntil: "networkidle" });
    await humanDelay(2000, 500);

    // Organic browse a bit before composing — don't go straight to posting
    await organicBrowse(page, 5000);

    // Click the compose tweet area
    const composeBox = await page.$('[data-testid="tweetTextarea_0"]');
    if (!composeBox) {
      // Try the "Tweet" button to open the compose modal
      await humanClick(page, '[data-testid="SideNav_NewTweet_Button"], [aria-label="Post"]');
      await humanDelay(1000, 300);
    }

    // Type the tweet text character by character
    await humanType(page, '[data-testid="tweetTextarea_0"]', draft.text);
    await humanDelay(1000, 300);

    // Verify character count is under 280
    const charCountEl = await page.$('[data-testid="character-count"]');
    if (charCountEl) {
      const countText = await charCountEl.textContent();
      const count = parseInt(countText?.replace(/\D/g, "") ?? "0", 10);
      if (count > 280) {
        console.error(`[poster] Draft ${draft.id} is ${count} chars — too long, rejecting`);
        await db.tweetDraft.update({
          where: { id: draft.id },
          data: { status: "REJECTED", approvalNote: "Over 280 characters" },
        });
        // Close compose without posting
        await page.keyboard.press("Escape");
        return 0;
      }
    }

    // Brief review pause — humans double-check before posting
    await humanDelay(2500, 800);

    // Hit the Post button
    const postBtn = await page.$('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
    if (!postBtn) {
      console.error("[poster] Could not find post button");
      return 0;
    }

    await postBtn.click();
    await humanDelay(3000, 500);

    // Mark as POSTED in DB
    await db.tweetDraft.update({
      where: { id: draft.id },
      data: { status: "POSTED" },
    });

    await recordAction({ type: "POST", replyText: draft.text.slice(0, 100) });
    console.log(`[poster] Posted: "${draft.text.slice(0, 60)}..."`);

    return 1;
  } catch (err) {
    console.error("[poster] Failed to post:", err);
    return 0;
  }
}

function isGoodPostingTime(): boolean {
  // Add a random offset per session so we don't always post at :00
  const offsetMinutes = Math.floor(Math.random() * 30);
  const now = new Date();
  const hour = now.getHours() + (now.getMinutes() + offsetMinutes) / 60;
  return GOOD_HOURS.some(([start, end]) => hour >= start && hour < end);
}
