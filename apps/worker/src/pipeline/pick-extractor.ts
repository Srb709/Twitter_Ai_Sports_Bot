import { db } from "@sports-engine/db";
import { extractPicks } from "@sports-engine/core";
import { aiExtractPicks } from "@sports-engine/ai";

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

      // Regex-based extraction first (zero cost)
      const regexPicks = extractPicks(fullText);

      // AI extraction only if regex found nothing
      const aiPicks =
        regexPicks.length === 0 && fullText.length > 30
          ? await aiExtractPicks(fullText).catch(() => [])
          : [];

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
