import type { ParsedPick, ClusterSignal } from "@sports-engine/shared";

interface PickGroup {
  key: string;
  picks: (ParsedPick & { postId: string; createdAt: Date })[];
}

export function clusterPicks(
  picks: (ParsedPick & { postId: string; createdAt: Date })[]
): ClusterSignal[] {
  const groups = new Map<string, PickGroup>();

  for (const pick of picks) {
    const key = buildClusterKey(pick);
    if (!groups.has(key)) {
      groups.set(key, { key, picks: [] });
    }
    groups.get(key)!.picks.push(pick);
  }

  return Array.from(groups.values())
    .filter((g) => g.picks.length >= 2)
    .map((g) => toClusterSignal(g))
    .sort((a, b) => b.trendScore - a.trendScore);
}

function buildClusterKey(pick: ParsedPick): string {
  const line = pick.line !== undefined ? roundLine(pick.line).toFixed(1) : "x";
  const player = pick.playerName
    ? normalizeNameForKey(pick.playerName)
    : "team";
  return `${pick.sport}|${player}|${pick.marketType}|${pick.betSide ?? "x"}|${line}`;
}

function toClusterSignal(group: PickGroup): ClusterSignal {
  const picks = group.picks;
  const sample = picks[0];
  const now = Date.now();

  const avgConfidence =
    picks.reduce((s, p) => s + (p.confidence ?? 0.5), 0) / picks.length;

  const newest = Math.max(...picks.map((p) => p.createdAt.getTime()));
  const ageHours = (now - newest) / 3_600_000;
  const recency = Math.max(0, 1 - ageHours / 24);

  const trendScore = computeTrendScore(picks.length, recency, avgConfidence);

  return {
    clusterKey: group.key,
    sport: sample.sport,
    playerName: sample.playerName,
    marketType: sample.marketType,
    betSide: sample.betSide,
    line: sample.line,
    supportCount: picks.length,
    confidence: avgConfidence,
    trendScore,
    tags: tagCluster(picks),
    sourcePostIds: [...new Set(picks.map((p) => p.postId))],
    label: buildLabel(sample),
  };
}

export function computeTrendScore(
  supportCount: number,
  recency: number,
  confidence: number
): number {
  return (
    Math.min(supportCount / 10, 1) * 0.4 + recency * 0.3 + confidence * 0.3
  );
}

export function tagCluster(picks: ParsedPick[]): string[] {
  const tags: string[] = [];
  const sports = [...new Set(picks.map((p) => p.sport))];
  tags.push(...sports);

  const hasOdds = picks.some((p) => p.odds !== undefined);
  if (hasOdds) {
    const avgOdds =
      picks.filter((p) => p.odds).reduce((s, p) => s + (p.odds ?? 0), 0) /
      picks.filter((p) => p.odds).length;
    if (avgOdds > 0 && avgOdds < 150) tags.push("short-dog");
    if (avgOdds < 0 && avgOdds > -150) tags.push("near-even");
  }

  if (picks[0]?.marketType === "NRFI" || picks[0]?.marketType === "YRFI") {
    tags.push("first-inning");
  }

  const supportCount = picks.length;
  if (supportCount >= 5) tags.push("strong-consensus");
  else if (supportCount >= 3) tags.push("consensus");

  return tags;
}

export function findFadeAngles(clusters: ClusterSignal[]): ClusterSignal[] {
  return clusters.filter(
    (c) =>
      c.supportCount >= 4 &&
      c.trendScore > 0.7 &&
      c.marketType !== "NRFI" &&
      c.marketType !== "YRFI"
  );
}

function buildLabel(pick: ParsedPick): string {
  const parts: string[] = [];
  if (pick.playerName) parts.push(pick.playerName);
  if (pick.betSide) parts.push(pick.betSide);
  if (pick.line !== undefined) parts.push(pick.line.toString());
  if (!parts.length && pick.gameLabel) parts.push(pick.gameLabel);
  return parts.join(" ") || pick.marketType;
}

function roundLine(line: number): number {
  return Math.round(line * 2) / 2;
}

function normalizeNameForKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}
