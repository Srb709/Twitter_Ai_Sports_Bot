import { db } from "@sports-engine/db";
import { extractPicks } from "@sports-engine/core";
import { aiExtractPicks } from "@sports-engine/ai";
import { isComplexPickPost, extractPicksWithThinking } from "@sports-engine/ai";

export async function extractPicksFromPosts(): Promise<number> {
  const unprocessed = await db.sourcePost.findMany({
    where: { processed: false },
    include: { media: { where: { ocrStatus: "DONE" } } },
    take: 50,
    orderBy: { scrapedAt: "asc" },
  });

  let count = 0;

  for (const post of unprocessed) {
    try {
      const ocrText = post.media
        .map((m) => m.ocrText ?? "")
        .filter(Boolean)
        .join("\n");

      const fullText = [post.textContent, ocrText].filter(Boolean).join("\n");

      if (!fullText.trim()) {
        await db.sourcePost.update({ where: { id: post.id }, data: { processed: true } });
        continue;
      }

      // Layer 1: Regex (zero cost, instant)
      const regexPicks = extractPicks(fullText);

      let aiPicks: Awaited<ReturnType<typeof aiExtractPicks>> = [];

      if (regexPicks.length === 0 && fullText.length > 30) {
        // Layer 2: Check if the post is complex enough to warrant extended thinking
        if (isComplexPickPost(fullText)) {
          // Layer 3: Extended thinking on Sonnet — used for SGPs, parlays, shorthand
          console.log(`[pick-extractor] Complex post detected — using extended thinking for post ${post.id}`);
          aiPicks = await extractPicksWithThinking(fullText).catch(() => []);

          // If extended thinking still got nothing, fall back to regular Haiku
          if (aiPicks.length === 0) {
            aiPicks = await aiExtractPicks(fullText).catch(() => []);
          }
        } else {
          // Layer 2: Regular Haiku AI extraction
          aiPicks = await aiExtractPicks(fullText).catch(() => []);
        }
      }

      const allPicks = [...regexPicks, ...aiPicks];

      for (const pick of allPicks) {
        await db.extractedPick.create({
          data: {
            sourcePostId: post.id,
            sport: pick.sport,
            league: pick.league ?? null,
            gameLabel: pick.gameLabel ?? null,
            teams: pick.teams,
            playerName: pick.playerName ?? null,
            marketType: pick.marketType as never,
            betSide: pick.betSide ? (pick.betSide as never) : null,
            line: pick.line ?? null,
            odds: pick.odds ?? null,
            normalizedLabel: pick.normalizedLabel,
            evidenceText: pick.evidenceText,
            confidence: pick.confidence,
          },
        });
      }

      await db.sourcePost.update({ where: { id: post.id }, data: { processed: true } });
      count += allPicks.length;
    } catch (err) {
      console.error(`[pick-extractor] Failed on post ${post.id}:`, err);
    }
  }

  return count;
}
