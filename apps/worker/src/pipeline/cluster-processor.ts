import { db } from "@sports-engine/db";
import { clusterPicks } from "@sports-engine/core";
import type { ParsedPick } from "@sports-engine/shared";

const LOOKBACK_HOURS = 24;

export async function runClusterPass(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000);

  const raw = await db.extractedPick.findMany({
    where: { createdAt: { gte: since } },
    include: { sourcePost: { select: { scrapedAt: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (raw.length === 0) return 0;

  const picks: (ParsedPick & { postId: string; createdAt: Date })[] = raw.map((p) => ({
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
    postId: p.sourcePostId,
    createdAt: p.createdAt,
  }));

  const clusters = clusterPicks(picks);
  let saved = 0;

  for (const signal of clusters) {
    const existing = await db.pickCluster.findFirst({
      where: { label: signal.label, sport: signal.sport ?? undefined },
    });

    let clusterId: string;

    if (existing) {
      await db.pickCluster.update({
        where: { id: existing.id },
        data: {
          trendScore: signal.trendScore,
          supportCount: signal.supportCount,
          confidence: signal.confidence,
          tags: signal.tags,
        },
      });
      clusterId = existing.id;
    } else {
      const created = await db.pickCluster.create({
        data: {
          label: signal.label,
          sport: signal.sport ?? null,
          clusterType: inferClusterType(signal),
          trendScore: signal.trendScore,
          supportCount: signal.supportCount,
          confidence: signal.confidence,
          tags: signal.tags,
        },
      });
      clusterId = created.id;
      saved++;
    }

    // Link picks to cluster (ignore duplicates)
    for (const postId of signal.sourcePostIds) {
      const pick = raw.find((p) => p.sourcePostId === postId);
      if (!pick) continue;
      await db.pickClusterMembership.upsert({
        where: { clusterId_extractedPickId: { clusterId, extractedPickId: pick.id } },
        update: {},
        create: { clusterId, extractedPickId: pick.id },
      });
    }
  }

  return saved;
}

function inferClusterType(
  signal: ReturnType<typeof clusterPicks>[number]
): "SAME_PICK" | "SAME_PLAYER" | "SAME_GAME" | "NRFI_YRFI" | "FADE_TARGET" {
  if (signal.marketType === "NRFI" || signal.marketType === "YRFI") return "NRFI_YRFI";
  if (signal.playerName) return signal.line !== undefined ? "SAME_PICK" : "SAME_PLAYER";
  return "SAME_GAME";
}
