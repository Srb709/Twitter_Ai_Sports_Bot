import type { Browser } from "playwright";
import { createBrowser } from "./scanner/browser.js";
import { ensureLoggedIn } from "./scanner/auth.js";
import { getAccountsToScan, scanAccount } from "./scanner/account-scanner.js";
import { processImages } from "./pipeline/image-handler.js";
import { extractPicksFromPosts } from "./pipeline/pick-extractor.js";
import { runClusterPass } from "./pipeline/cluster-processor.js";
import { generateTweetDrafts } from "./pipeline/tweet-generator.js";
import { sleep } from "@sports-engine/shared";

const SCAN_INTERVAL_MINUTES = parseInt(
  process.env.WORKER_SCAN_INTERVAL_MINUTES ?? "30",
  10
);

export interface WorkerLoopOptions {
  once?: boolean;
  debug?: boolean;
}

export async function runWorkerLoop(opts: WorkerLoopOptions = {}): Promise<void> {
  let browser: Browser | null = null;

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
      const cycleStart = Date.now();
      console.log(`[worker] Starting cycle at ${new Date().toISOString()}`);

      // 1. Scan accounts
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
          console.log(`[worker] ${account.username}: +${result.newPostCount} posts`);
        }
      }

      // 2. Process images (OCR)
      const ocrCount = await processImages();
      if (ocrCount > 0) console.log(`[worker] OCR processed: ${ocrCount} images`);

      // 3. Extract picks
      const pickCount = await extractPicksFromPosts();
      if (pickCount > 0) console.log(`[worker] Picks extracted: ${pickCount}`);

      // 4. Cluster
      const clusterCount = await runClusterPass();
      if (clusterCount > 0) console.log(`[worker] New clusters: ${clusterCount}`);

      // 5. Generate tweet drafts
      const draftCount = await generateTweetDrafts();
      if (draftCount > 0) console.log(`[worker] Tweet drafts created: ${draftCount}`);

      const elapsed = Date.now() - cycleStart;
      console.log(`[worker] Cycle done in ${(elapsed / 1000).toFixed(1)}s`);

      if (!opts.once) {
        const waitMs = Math.max(0, SCAN_INTERVAL_MINUTES * 60_000 - elapsed);
        console.log(`[worker] Sleeping ${Math.round(waitMs / 1000)}s until next cycle`);
        await sleep(waitMs);
      }
    } while (!opts.once);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
