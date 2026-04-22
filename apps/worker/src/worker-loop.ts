import type { Browser } from "playwright";
import { createBrowser } from "./scanner/browser.js";
import { ensureLoggedIn } from "./scanner/auth.js";
import { getAccountsToScan, scanAccount } from "./scanner/account-scanner.js";
import { processImages } from "./pipeline/image-handler.js";
import { extractPicksFromPosts } from "./pipeline/pick-extractor.js";
import { runClusterPass } from "./pipeline/cluster-processor.js";
import { generateTweetDrafts } from "./pipeline/tweet-generator.js";
import { runBriefingGenerator } from "./pipeline/briefing-generator.js";
import { runFollowerHunter } from "./growth/follower-hunter.js";
import { runEngagementEngine } from "./growth/engagement-engine.js";
import { runUnfollowManager } from "./growth/unfollow-manager.js";
import { runAutoPoster } from "./growth/auto-poster.js";
import { runHashtagSurfer } from "./growth/hashtag-surfer.js";
import { dailySummary } from "./growth/action-budget.js";
import { sleep } from "@sports-engine/shared";

const SCAN_INTERVAL_MINUTES = parseInt(
  process.env.WORKER_SCAN_INTERVAL_MINUTES ?? "30",
  10
);

// Growth runs less often than scanning — every N content cycles
const GROWTH_EVERY_N_CYCLES = parseInt(process.env.GROWTH_EVERY_N_CYCLES ?? "2", 10);

export interface WorkerLoopOptions {
  once?: boolean;
  debug?: boolean;
  noGrowth?: boolean;
}

export async function runWorkerLoop(opts: WorkerLoopOptions = {}): Promise<void> {
  let browser: Browser | null = null;
  let cycleCount = 0;

  const shutdown = async () => {
    console.log("[worker] Shutting down...");
    await browser?.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await ensureLoggedIn(page);

    do {
      cycleCount++;
      const cycleStart = Date.now();
      console.log(`\n[worker] ── Cycle #${cycleCount} at ${new Date().toISOString()} ──`);

      // ── Content pipeline ────────────────────────────────────────────────────

      const accounts = await getAccountsToScan(SCAN_INTERVAL_MINUTES);
      console.log(`[worker] Scanning ${accounts.length} accounts`);

      for (const account of accounts) {
        const result = await scanAccount(page, account.username, {
          maxScrolls: parseInt(process.env.WORKER_MAX_SCROLLS ?? "5", 10),
          debug: opts.debug ?? false,
          scanIntervalMinutes: SCAN_INTERVAL_MINUTES,
        });

        if (result.errorMessage) {
          console.error(`[worker] ${account.username} error: ${result.errorMessage}`);
        } else {
          console.log(`[worker] @${account.username}: +${result.newPostCount} posts`);
        }
      }

      const ocrCount = await processImages();
      if (ocrCount > 0) console.log(`[worker] OCR: ${ocrCount} images`);

      const pickCount = await extractPicksFromPosts();
      if (pickCount > 0) console.log(`[worker] Picks: ${pickCount}`);

      const clusterCount = await runClusterPass();
      if (clusterCount > 0) console.log(`[worker] Clusters: ${clusterCount} new`);

      const draftCount = await generateTweetDrafts();
      if (draftCount > 0) console.log(`[worker] Drafts: ${draftCount} created`);

      // Morning briefing (runs once per day, no-ops if already generated)
      await runBriefingGenerator();

      // ── Growth cycle (every N content cycles) ───────────────────────────────

      const growthEnabled = !opts.noGrowth && process.env.GROWTH_ENABLED !== "false";

      if (growthEnabled && cycleCount % GROWTH_EVERY_N_CYCLES === 0) {
        console.log("[worker] ── Growth cycle ──");

        // Post approved drafts first (highest priority)
        const posted = await runAutoPoster(page);
        if (posted > 0) console.log(`[worker] Posted ${posted} tweet(s)`);

        // Hashtag surfing — like and discover accounts
        const surfed = await runHashtagSurfer(page);
        console.log(`[worker] Hashtag surf: ${surfed.likes} likes, ${surfed.followed} follows`);

        // Find new accounts to follow
        const followed = await runFollowerHunter(page);
        if (followed > 0) console.log(`[worker] Followed ${followed} accounts`);

        // Engage with posts
        const engaged = await runEngagementEngine(page);
        if (engaged.likes + engaged.replies > 0) {
          console.log(`[worker] Engagement: ${engaged.likes} likes, ${engaged.replies} replies`);
        }

        // Clean up non-followers (runs less aggressively)
        if (cycleCount % (GROWTH_EVERY_N_CYCLES * 4) === 0) {
          const unfollowed = await runUnfollowManager(page);
          if (unfollowed > 0) console.log(`[worker] Unfollowed ${unfollowed}`);
        }

        const summary = await dailySummary();
        console.log(`[worker] Budget today — ${summary}`);
      }

      const elapsed = Date.now() - cycleStart;
      console.log(`[worker] Cycle done in ${(elapsed / 1000).toFixed(1)}s`);

      if (!opts.once) {
        const waitMs = Math.max(0, SCAN_INTERVAL_MINUTES * 60_000 - elapsed);
        console.log(`[worker] Sleeping ${Math.round(waitMs / 1000)}s\n`);
        await sleep(waitMs);
      }
    } while (!opts.once);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
