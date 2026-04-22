import { db } from "@sports-engine/db";
import { generateTweetBatch } from "@sports-engine/ai";
import { refineTweet } from "@sports-engine/ai";
import type { ClusterSignal, ParsedPick } from "@sports-engine/shared";

const LOOKBACK_HOURS = 24;

export async function generateTweetDrafts(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000);

  const clusters = await db.pickCluster.findMany({
    where: { updatedAt: { gte: since } },
    orderBy: { trendScore: "desc" },
    take: 10,
    include: {
      members: { include: { extractedPick: true }, take: 5 },
    },
  });

  if (clusters.length === 0) return 0;

  const clusterSignals: ClusterSignal[] = clusters.map((c) => ({
    clusterKey: c.id,
    sport: c.sport ?? undefined,
    playerName: c.members[0]?.extractedPick?.playerName ?? undefined,
    marketType: (c.members[0]?.extractedPick?.marketType ?? "OTHER") as ClusterSignal["marketType"],
    betSide: (c.members[0]?.extractedPick?.betSide ?? undefined) as ClusterSignal["betSide"],
    line: c.members[0]?.extractedPick?.line ?? undefined,
    supportCount: c.supportCount,
    confidence: c.confidence,
    trendScore: c.trendScore,
    tags: c.tags as string[],
    sourcePostIds: c.members.map((m) => m.extractedPick.sourcePostId),
    label: c.label,
  }));

  const recentPickRows = await db.extractedPick.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { confidence: "desc" },
    take: 20,
  });

  const recentPicks: ParsedPick[] = recentPickRows.map((p) => ({
    sport: p.sport,
    league: p.league ?? undefined,
    gameLabel: p.gameLabel ?? undefined,
    teams: p.teams as string[],
    playerName: p.playerName ?? undefined,
    marketType: p.marketType as ParsedPick["marketType"],
    betSide: p.betSide ? (p.betSide as ParsedPick["betSide"]) : undefined,
    line: p.line ?? undefined,
    odds: p.odds ?? undefined,
    normalizedLabel: p.normalizedLabel,
    evidenceText: p.evidenceText,
    confidence: p.confidence,
  }));

  let saved = 0;

  try {
    const tweets = await generateTweetBatch(clusterSignals, recentPicks);

    for (const tweet of tweets) {
      // Self-critique loop — Claude scores and rewrites if below threshold
      let finalText = tweet.text;
      let refinementMeta: Record<string, unknown> = {};

      try {
        const refined = await refineTweet(tweet.text, tweet.tweetType);
        finalText = refined.finalText;
        refinementMeta = {
          score: refined.score,
          wasRewritten: refined.wasRewritten,
          reasoning: refined.reasoning,
        };

        if (refined.wasRewritten) {
          console.log(
            `[tweet-generator] Rewrote ${tweet.tweetType} (score ${refined.score}/10): ${refined.reasoning}`
          );
        }
      } catch (refineErr) {
        const msg = refineErr instanceof Error ? refineErr.message : String(refineErr);
        if (!msg.startsWith("BUDGET_EXCEEDED")) {
          console.warn(`[tweet-generator] Refinement failed for ${tweet.tweetType}: ${msg}`);
        }
        // Use original text if refinement fails
      }

      await db.tweetDraft.create({
        data: {
          tweetType: tweet.tweetType as never,
          text: finalText,
          status: "DRAFT",
          generationModel: tweet.model,
          sourceEvidence: {
            clusterIds: clusters.map((c) => c.id),
            pickIds: recentPickRows.slice(0, 5).map((p) => p.id),
            costUsd: tweet.costUsd,
            refinement: refinementMeta,
          },
          clusters: {
            create: clusters.slice(0, 3).map((c) => ({ clusterId: c.id })),
          },
        },
      });
      saved++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("BUDGET_EXCEEDED")) {
      console.warn("[tweet-generator] Budget cap reached — skipping.");
      return 0;
    }
    throw err;
  }

  return saved;
}
