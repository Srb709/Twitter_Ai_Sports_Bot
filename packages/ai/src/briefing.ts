/**
 * Daily intelligence briefing generator.
 * Uses claude-sonnet-4-6 (smarter model) to synthesize all of yesterday's picks,
 * clusters, and account activity into a structured morning report.
 * Runs once per day — result cached in SystemSetting DB table.
 */
import Anthropic from "anthropic";
import { checkBudget, estimateCost, recordAnthropicUsage } from "./cost-guard.js";

// Sonnet for better synthesis of complex multi-source data
const BRIEFING_MODEL = "claude-sonnet-4-6";

export interface DailyBriefing {
  headline: string;
  topPlays: {
    label: string;
    sport: string;
    supportCount: number;
    angle: string;
  }[];
  fadeAngles: {
    label: string;
    reasoning: string;
  }[];
  hotAccounts: string[];
  coldAccounts: string[];
  marketNotes: string;
  generatedAt: string;
}

export interface BriefingInput {
  clusters: {
    label: string;
    sport: string | null;
    supportCount: number;
    trendScore: number;
    tags: string[];
  }[];
  picks: {
    normalizedLabel: string;
    sport: string;
    confidence: number;
    odds: number | null;
  }[];
  accountActivity: {
    username: string;
    newPostCount: number;
    lastScannedAt: string | null;
  }[];
}

export async function generateDailyBriefing(input: BriefingInput): Promise<DailyBriefing> {
  // Sonnet costs more — budget for larger input + output
  await checkBudget(estimateCost("anthropic", 2500, 700));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const dataStr = JSON.stringify(
    {
      topClusters: input.clusters.slice(0, 15),
      samplePicks: input.picks.slice(0, 25),
      accountActivity: input.accountActivity.slice(0, 12),
    },
    null,
    2
  );

  const response = await client.messages.create({
    model: BRIEFING_MODEL,
    max_tokens: 900,
    system: [
      {
        type: "text",
        text: `You are a sharp sports betting analyst producing a daily morning briefing for a betting content account.

Given aggregated pick data from multiple tracked accounts, produce a concise intelligence report.

Return ONLY this JSON (no prose, no fences):
{
  "headline": "one punchy sentence about today's standout trend or most notable consensus",
  "topPlays": [
    { "label": "pick name", "sport": "MLB", "supportCount": 5, "angle": "sharp 1-2 sentence reason" }
  ],
  "fadeAngles": [
    { "label": "heavily-backed pick name", "reasoning": "sharp 1-2 sentence case for fading the public" }
  ],
  "hotAccounts": ["username1", "username2"],
  "coldAccounts": ["username3"],
  "marketNotes": "2–3 sentences on overall market themes, line movement patterns, or sport-specific angles today"
}

Rules:
- Max 3 topPlays, max 2 fadeAngles
- hotAccounts = accounts with most posts today (active/prolific)
- coldAccounts = accounts that haven't posted in 12+ hours
- Be direct and decisive. No hedging. Sound like a sharp analyst, not a disclaimer machine.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Today's aggregated data:\n\n${dataStr}\n\nGenerate the morning briefing.`,
      },
    ],
  });

  await recordAnthropicUsage({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: (response.usage as Record<string, number>)
      .cache_creation_input_tokens,
    cache_read_input_tokens: (response.usage as Record<string, number>).cache_read_input_tokens,
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected briefing response type");

  const clean = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  const parsed = JSON.parse(clean) as Omit<DailyBriefing, "generatedAt">;

  return { ...parsed, generatedAt: new Date().toISOString() };
}
