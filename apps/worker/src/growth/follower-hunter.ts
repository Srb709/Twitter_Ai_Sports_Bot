/**
 * Finds real sports betting accounts to follow.
 * Strategy: visit followers of established accounts, filter for humans, follow them.
 * Never follows bots, parody accounts, or accounts we've already followed.
 */
import type { Page } from "playwright";
import { db } from "@sports-engine/db";
import { canAct, recordAction } from "./action-budget.js";
import { humanClick, humanDelay, humanScroll, organicBrowse } from "./human-behavior.js";

// Seed accounts whose followers are likely our target audience
const SEED_ACCOUNTS = [
  "ActionNetworkHQ",
  "BettingPros",
  "VegasInsider",
  "SharpSide",
  "WagerTalk",
  "SportsLine",
  "TheLines",
  "Covers",
];

// Keywords that suggest a real betting account worth following
const POSITIVE_SIGNALS = [
  "picks", "bets", "betting", "wagering", "handicapper",
  "lines", "props", "parlay", "sharp", "degen", "fade",
  "mlb", "nba", "nfl", "nhl", "cbbb",
];

// Keywords that suggest bot/spam accounts — skip these
const NEGATIVE_SIGNALS = [
  "follow back", "followback", "follow for follow", "f4f",
  "crypto", "nft", "only fans", "onlyfans", "forex",
  "make money", "dm for picks", "guaranteed wins",
];

export async function runFollowerHunter(page: Page): Promise<number> {
  if (!(await canAct("FOLLOW"))) {
    console.log("[follower-hunter] Daily follow budget exhausted");
    return 0;
  }

  // Pick a random seed account each run — vary the pattern
  const seed = SEED_ACCOUNTS[Math.floor(Math.random() * SEED_ACCOUNTS.length)];
  console.log(`[follower-hunter] Hunting via @${seed}`);

  let followed = 0;

  try {
    // Navigate to the seed account's followers page
    await page.goto(`https://x.com/${seed}/followers`, { waitUntil: "networkidle" });
    await humanDelay(2000, 500);

    // Scroll to load more followers
    await humanScroll(page, 600);
    await humanDelay(1500, 400);

    // Find all user cells
    const userLinks = await page.$$('[data-testid="UserCell"]');

    for (const cell of userLinks) {
      if (!(await canAct("FOLLOW"))) break;

      try {
        // Extract username and bio from the cell
        const username = await cell.$eval(
          'a[href^="/"]',
          (el) => el.getAttribute("href")?.replace("/", "") ?? ""
        ).catch(() => "");

        if (!username || username.includes("/")) continue;

        const bio = await cell.$eval(
          '[data-testid="UserDescription"], [class*="bio"]',
          (el) => el.textContent ?? ""
        ).catch(() => "");

        // Skip if already followed or already in our DB
        if (await alreadyFollowed(username)) continue;

        // Score this account
        if (!looksHuman(bio)) continue;

        // Find the follow button inside this cell
        const followBtn = await cell.$('[data-testid*="follow"]');
        if (!followBtn) continue;

        const btnText = await followBtn.textContent();
        if (!btnText?.toLowerCase().includes("follow")) continue;
        if (btnText.toLowerCase().includes("following")) continue;

        // Do some organic browsing before following — don't auto-fire
        if (Math.random() < 0.3) {
          await organicBrowse(page, 3000);
        }

        await humanClick(page, `[data-testid="UserCell"]:has(a[href="/${username}"]) [data-testid*="follow"]`);
        await humanDelay(1200, 400);

        await recordAction({ type: "FOLLOW", targetUsername: username });
        console.log(`[follower-hunter] Followed @${username}`);
        followed++;

        // Randomize gap between follows — 15-45 seconds
        await humanDelay(25000, 10000);

      } catch {
        // Individual cell errors are non-fatal
      }
    }
  } catch (err) {
    console.error("[follower-hunter] Error:", err);
  }

  return followed;
}

function looksHuman(bio: string): boolean {
  const lower = bio.toLowerCase();

  // Must have at least one positive signal
  const hasPositive = POSITIVE_SIGNALS.some((s) => lower.includes(s));
  if (!hasPositive) return false;

  // Reject if any negative signal present
  const hasNegative = NEGATIVE_SIGNALS.some((s) => lower.includes(s));
  if (hasNegative) return false;

  return true;
}

async function alreadyFollowed(username: string): Promise<boolean> {
  const existing = await db.growthAction.findFirst({
    where: {
      actionType: "FOLLOW",
      targetUsername: username,
      success: true,
    },
  });
  return !!existing;
}
