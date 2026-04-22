/**
 * Unfollows accounts that didn't follow back after WAIT_DAYS.
 * Skips accounts we've been following less than WAIT_DAYS — too soon to judge.
 * Keeps accounts we actually track for content scraping.
 */
import type { Page } from "playwright";
import { db } from "@sports-engine/db";
import { canAct, recordAction } from "./action-budget.js";
import { humanClick, humanDelay } from "./human-behavior.js";

const WAIT_DAYS = 5;      // days before we unfollow a non-follower-back
const BATCH_SIZE = 15;    // max unfollows per run

export async function runUnfollowManager(page: Page): Promise<number> {
  if (!(await canAct("UNFOLLOW"))) {
    console.log("[unfollow] Daily unfollow budget exhausted");
    return 0;
  }

  const cutoff = new Date(Date.now() - WAIT_DAYS * 86_400_000);

  // Find accounts we followed more than WAIT_DAYS ago
  const followed = await db.growthAction.findMany({
    where: {
      actionType: "FOLLOW",
      success: true,
      performedAt: { lt: cutoff },
    },
    orderBy: { performedAt: "asc" },
    take: BATCH_SIZE * 3, // fetch more so we can filter out already-unfollowed
  });

  if (followed.length === 0) return 0;

  // Filter out any we've already unfollowed
  const alreadyUnfollowed = new Set(
    (
      await db.growthAction.findMany({
        where: { actionType: "UNFOLLOW", success: true },
        select: { targetUsername: true },
      })
    ).map((r) => r.targetUsername ?? "")
  );

  // Also skip accounts we actively scrape for content
  const trackedUsernames = new Set(
    (await db.trackedAccount.findMany({ select: { username: true } }))
      .map((a) => a.username.toLowerCase())
  );

  const candidates = followed
    .filter(
      (f) =>
        f.targetUsername &&
        !alreadyUnfollowed.has(f.targetUsername) &&
        !trackedUsernames.has(f.targetUsername.toLowerCase())
    )
    .slice(0, BATCH_SIZE);

  if (candidates.length === 0) return 0;

  console.log(`[unfollow] ${candidates.length} candidates to unfollow`);
  let unfollowed = 0;

  for (const action of candidates) {
    if (!(await canAct("UNFOLLOW"))) break;

    const username = action.targetUsername!;

    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: "networkidle" });
      await humanDelay(1500, 400);

      // Check if they follow us back (find "Follows you" badge)
      const followsBack = await page.$('[data-testid="userFollowIndicator"]').catch(() => null);
      if (followsBack) {
        console.log(`[unfollow] @${username} follows back — keeping`);
        continue;
      }

      // Find the Following button (which means we're currently following them)
      const followingBtn = await page.$('[data-testid="userActions"] [aria-label*="Following"]');
      if (!followingBtn) {
        // We're not following them (maybe already removed) — just record
        await recordAction({ type: "UNFOLLOW", targetUsername: username });
        continue;
      }

      await humanClick(page, '[data-testid="userActions"] [aria-label*="Following"]');
      await humanDelay(800, 200);

      // Confirm the "Unfollow" button in the confirmation dialog
      const confirmBtn = await page.$('[data-testid="confirmationSheetConfirm"]');
      if (confirmBtn) {
        await confirmBtn.click();
        await humanDelay(1000, 300);
      }

      await recordAction({ type: "UNFOLLOW", targetUsername: username });
      console.log(`[unfollow] Unfollowed @${username}`);
      unfollowed++;

      // Space out unfollows — 20-40 seconds apart
      await humanDelay(28000, 8000);

    } catch (err) {
      console.error(`[unfollow] Failed for @${username}:`, err);
      await recordAction({ type: "UNFOLLOW", targetUsername: username, success: false });
    }
  }

  return unfollowed;
}
