/**
 * Finds real sports betting accounts to follow.
 * Uses Claude AI scoring instead of keyword matching — far smarter filtering.
 * Quick keyword pre-screen eliminates obvious spam before spending API budget.
 */
import type { Page } from "playwright";
import { db } from "@sports-engine/db";
import { scoreAccount } from "@sports-engine/ai";
import { canAct, recordAction } from "./action-budget.js";
import { humanClick, humanDelay, humanScroll, organicBrowse } from "./human-behavior.js";

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

// Fast pre-screen: reject obvious spam before calling Claude (saves budget)
const INSTANT_REJECT = [
  "follow back", "followback", "f4f", "crypto", "nft", "onlyfans",
  "forex", "guaranteed wins", "dm for picks $", "📈📉",
];

export async function runFollowerHunter(page: Page): Promise<number> {
  if (!(await canAct("FOLLOW"))) {
    console.log("[follower-hunter] Daily follow budget exhausted");
    return 0;
  }

  const seed = SEED_ACCOUNTS[Math.floor(Math.random() * SEED_ACCOUNTS.length)];
  console.log(`[follower-hunter] Hunting via @${seed}`);

  let followed = 0;

  try {
    await page.goto(`https://x.com/${seed}/followers`, { waitUntil: "networkidle" });
    await humanDelay(2000, 500);
    await humanScroll(page, 600);
    await humanDelay(1500, 400);

    const userCells = await page.$$('[data-testid="UserCell"]');

    for (const cell of userCells) {
      if (!(await canAct("FOLLOW"))) break;

      try {
        const username = await cell
          .$eval('a[href^="/"]', (el) => el.getAttribute("href")?.replace("/", "") ?? "")
          .catch(() => "");

        if (!username || username.includes("/")) continue;
        if (await alreadyFollowed(username)) continue;

        const bio = await cell
          .$eval('[data-testid="UserDescription"]', (el) => el.textContent ?? "")
          .catch(() => "");

        // Step 1: instant keyword reject (no API cost)
        if (instantReject(bio)) continue;

        // Step 2: Claude AI scoring
        const aiScore = await scoreAccount({ username, bio }).catch(() => null);

        if (!aiScore?.relevant) {
          if (aiScore) {
            console.log(`[follower-hunter] Skipping @${username} (score ${aiScore.score.toFixed(2)}): ${aiScore.reasoning}`);
          }
          continue;
        }

        const followBtn = await cell.$('[data-testid*="follow"]');
        if (!followBtn) continue;

        const btnText = await followBtn.textContent();
        if (!btnText?.toLowerCase().includes("follow")) continue;
        if (btnText.toLowerCase().includes("following")) continue;

        if (Math.random() < 0.3) await organicBrowse(page, 3000);

        await humanClick(
          page,
          `[data-testid="UserCell"]:has(a[href="/${username}"]) [data-testid*="follow"]`
        );
        await humanDelay(1200, 400);

        await recordAction({ type: "FOLLOW", targetUsername: username });
        console.log(
          `[follower-hunter] Followed @${username} (score ${aiScore.score.toFixed(2)}): ${aiScore.reasoning}`
        );
        followed++;

        await humanDelay(25000, 10000);
      } catch {
        // Non-fatal per-cell error
      }
    }
  } catch (err) {
    console.error("[follower-hunter] Error:", err);
  }

  return followed;
}

function instantReject(bio: string): boolean {
  const lower = bio.toLowerCase();
  return INSTANT_REJECT.some((s) => lower.includes(s));
}

async function alreadyFollowed(username: string): Promise<boolean> {
  const existing = await db.growthAction.findFirst({
    where: { actionType: "FOLLOW", targetUsername: username, success: true },
  });
  return !!existing;
}
