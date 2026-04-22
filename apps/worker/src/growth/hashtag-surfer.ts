/**
 * Surfs trending sports betting hashtags.
 * Likes posts, discovers new accounts to follow, and builds presence in the niche.
 * Randomizes which hashtags to visit each run — no detectable pattern.
 */
import type { Page } from "playwright";
import { canAct, recordAction } from "./action-budget.js";
import { humanDelay, humanScroll, organicBrowse } from "./human-behavior.js";
import { db } from "@sports-engine/db";

const HASHTAGS = [
  "#MLBpicks",
  "#NBApicks",
  "#NFLpicks",
  "#sportsbetting",
  "#freepicks",
  "#NRFI",
  "#YRFI",
  "#sharpaction",
  "#bettingtips",
  "#picksandparlays",
  "#sportspicks",
  "#NBAbet",
  "#MLBbet",
];

export async function runHashtagSurfer(page: Page): Promise<{ likes: number; followed: number }> {
  const results = { likes: 0, followed: 0 };

  // Pick 1-3 random hashtags to browse this run
  const shuffled = [...HASHTAGS].sort(() => Math.random() - 0.5);
  const targets = shuffled.slice(0, 1 + Math.floor(Math.random() * 2));

  for (const tag of targets) {
    console.log(`[hashtag-surfer] Surfing ${tag}`);

    try {
      const url = `https://x.com/search?q=${encodeURIComponent(tag)}&f=live`;
      await page.goto(url, { waitUntil: "networkidle" });
      await humanDelay(2000, 600);

      // Organic scroll before engaging
      await organicBrowse(page, 4000);

      const articles = await page.$$('article[data-testid="tweet"]');

      for (const article of articles.slice(0, 12)) {
        if (Math.random() < 0.35) continue; // Skip some posts naturally

        try {
          const postKey = await extractPostKey(article);
          if (!postKey) continue;

          // Like posts
          if (await canAct("LIKE") && !(await alreadyLiked(postKey))) {
            const likeBtn = await article.$('[data-testid="like"]');
            if (likeBtn) {
              await humanDelay(800, 300);
              await likeBtn.click();
              await humanDelay(1000, 200);
              await recordAction({ type: "LIKE", targetPostKey: postKey });
              results.likes++;

              await humanDelay(8000, 3000);
            }
          }

          // Occasionally visit the poster's profile and consider following
          if (await canAct("FOLLOW") && Math.random() < 0.15) {
            const profileLink = await article.$('a[href^="/"][role="link"]:not([href*="/status/"])');
            if (profileLink) {
              const href = await profileLink.getAttribute("href");
              const username = href?.replace("/", "")?.split("/")?.[0];

              if (username && !(await alreadyFollowed(username))) {
                await profileLink.click();
                await humanDelay(2000, 500);

                // Quick profile check — does it look relevant?
                const bio = await page.$eval(
                  '[data-testid="UserDescription"]',
                  (el) => el.textContent ?? ""
                ).catch(() => "");

                const followBtn = await page.$('[data-testid="placementTracking"] [data-testid*="follow"]');
                const btnText = await followBtn?.textContent();

                if (
                  followBtn &&
                  btnText?.toLowerCase().includes("follow") &&
                  !btnText.toLowerCase().includes("following") &&
                  looksRelevant(bio)
                ) {
                  await followBtn.click();
                  await humanDelay(1200, 400);
                  await recordAction({ type: "FOLLOW", targetUsername: username });
                  results.followed++;
                  console.log(`[hashtag-surfer] Followed @${username}`);

                  await humanDelay(20000, 8000);
                }

                // Go back to search results
                await page.goBack({ waitUntil: "networkidle" });
                await humanDelay(1500, 400);
              }
            }
          }

          await humanScroll(page, 250);
          await humanDelay(1500, 600);

        } catch {
          // Non-fatal per-post error
        }
      }

      // Pause between hashtags — 2-5 minutes
      if (targets.indexOf(tag) < targets.length - 1) {
        await humanDelay(180000, 60000);
      }

    } catch (err) {
      console.error(`[hashtag-surfer] Error on ${tag}:`, err);
    }
  }

  return results;
}

function looksRelevant(bio: string): boolean {
  const lower = bio.toLowerCase();
  const signals = ["picks", "betting", "bets", "wagering", "props", "lines", "sharp", "parlay", "handicap"];
  return signals.some((s) => lower.includes(s));
}

async function alreadyLiked(postKey: string): Promise<boolean> {
  const row = await db.growthAction.findFirst({
    where: { actionType: "LIKE", targetPostKey: postKey, success: true },
  });
  return !!row;
}

async function alreadyFollowed(username: string): Promise<boolean> {
  const row = await db.growthAction.findFirst({
    where: { actionType: "FOLLOW", targetUsername: username, success: true },
  });
  return !!row;
}

async function extractPostKey(article: Awaited<ReturnType<Page["$"]>>): Promise<string | null> {
  if (!article) return null;
  try {
    const href = await article.$eval(
      'a[href*="/status/"]',
      (el) => el.getAttribute("href") ?? ""
    );
    const match = href.match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
