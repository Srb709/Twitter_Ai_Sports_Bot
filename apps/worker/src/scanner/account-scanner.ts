import type { Page } from "playwright";
import type { WorkerConfig } from "@sports-engine/shared";
import { randomDelay, sha256, extractTweetId } from "@sports-engine/shared";
import { collectPosts } from "./post-collector.js";
import { db } from "@sports-engine/db";

export interface ScanResult {
  accountId: string;
  username: string;
  newPostCount: number;
  errorMessage?: string;
}

export async function scanAccount(
  page: Page,
  username: string,
  config: WorkerConfig
): Promise<ScanResult> {
  const account = await db.trackedAccount.findUnique({ where: { username } });
  if (!account) {
    return { accountId: "", username, newPostCount: 0, errorMessage: "Account not found in DB" };
  }

  let newPostCount = 0;

  try {
    const rawPosts = await collectPosts(page, username, {
      maxScrolls: config.maxScrolls,
      debug: config.debug,
    });

    for (const raw of rawPosts) {
      const externalPostKey = extractTweetId(raw.url);
      if (!externalPostKey) continue;

      const contentHash = sha256(raw.text);

      const existing = await db.sourcePost.findUnique({
        where: { externalPostKey },
      });
      if (existing) continue;

      await db.sourcePost.create({
        data: {
          trackedAccountId: account.id,
          externalUrl: raw.url,
          externalPostKey,
          textContent: raw.text,
          contentHash,
          postedAt: raw.postedAt ? new Date(raw.postedAt) : undefined,
          screenshotPath: raw.screenshotPath,
          rawJson: raw.rawJson ?? undefined,
          media: raw.mediaUrls?.length
            ? {
                create: raw.mediaUrls.map((url) => ({
                  mediaUrl: url,
                  ocrStatus: "PENDING" as const,
                })),
              }
            : undefined,
        },
      });

      newPostCount++;
    }

    await db.trackedAccount.update({
      where: { id: account.id },
      data: { lastScannedAt: new Date() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { accountId: account.id, username, newPostCount, errorMessage: msg };
  }

  await randomDelay(2000, 5000);

  return { accountId: account.id, username, newPostCount };
}

export async function getAccountsToScan(globalIntervalMinutes: number) {
  const cutoff = new Date(Date.now() - globalIntervalMinutes * 60_000);

  return db.trackedAccount.findMany({
    where: {
      active: true,
      OR: [{ lastScannedAt: null }, { lastScannedAt: { lt: cutoff } }],
    },
    orderBy: [{ priority: "asc" }, { lastScannedAt: "asc" }],
  });
}
