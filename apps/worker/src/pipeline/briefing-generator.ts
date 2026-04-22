/**
 * Runs once per day. Reads yesterday's clusters, picks, and account activity,
 * then asks Claude Sonnet to synthesize a morning intelligence briefing.
 * Stores result in SystemSetting so the mobile app can display it.
 */
import { db } from "@sports-engine/db";
import { generateDailyBriefing } from "@sports-engine/ai";

const LOOKBACK_HOURS = 24;

function todayKey(): string {
  const d = new Date();
  return `briefing_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}_${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function runBriefingGenerator(): Promise<boolean> {
  const key = todayKey();

  // Only generate once per day
  const existing = await db.systemSetting.findUnique({ where: { key } });
  if (existing) return false;

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000);

  const [clusters, picks, accounts] = await Promise.all([
    db.pickCluster.findMany({
      where: { updatedAt: { gte: since } },
      orderBy: { trendScore: "desc" },
      take: 15,
      select: { label: true, sport: true, supportCount: true, trendScore: true, tags: true },
    }),
    db.extractedPick.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { confidence: "desc" },
      take: 25,
      select: { normalizedLabel: true, sport: true, confidence: true, odds: true },
    }),
    db.trackedAccount.findMany({
      where: { active: true },
      select: { username: true, lastScannedAt: true, _count: { select: { posts: true } } },
      orderBy: { lastScannedAt: "desc" },
      take: 12,
    }),
  ]);

  if (clusters.length === 0 && picks.length === 0) {
    console.log("[briefing] Not enough data to generate briefing — skipping");
    return false;
  }

  try {
    console.log("[briefing] Generating daily intelligence briefing with Claude Sonnet...");

    const briefing = await generateDailyBriefing({
      clusters: clusters.map((c) => ({
        label: c.label,
        sport: c.sport,
        supportCount: c.supportCount,
        trendScore: c.trendScore,
        tags: c.tags as string[],
      })),
      picks: picks.map((p) => ({
        normalizedLabel: p.normalizedLabel,
        sport: p.sport,
        confidence: p.confidence,
        odds: p.odds,
      })),
      accountActivity: accounts.map((a) => ({
        username: a.username,
        newPostCount: a._count.posts,
        lastScannedAt: a.lastScannedAt?.toISOString() ?? null,
      })),
    });

    await db.systemSetting.upsert({
      where: { key },
      update: { value: JSON.stringify(briefing) },
      create: { key, value: JSON.stringify(briefing) },
    });

    console.log(`[briefing] Briefing saved: "${briefing.headline}"`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("BUDGET_EXCEEDED")) {
      console.warn("[briefing] Budget cap hit — skipping briefing generation.");
      return false;
    }
    console.error("[briefing] Failed:", err);
    return false;
  }
}
