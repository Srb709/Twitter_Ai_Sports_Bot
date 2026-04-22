/**
 * Extended thinking pick extractor.
 * Used ONLY for complex, ambiguous posts where regex found nothing and
 * the post looks pick-related (SGP legs, parlays, vague shorthand).
 * Switches from Haiku → Sonnet and enables extended thinking so Claude
 * reasons step-by-step before producing structured output.
 * More expensive — only triggered on hard cases.
 */
import Anthropic from "anthropic";
import type { ParsedPick } from "@sports-engine/shared";
import { checkBudget, recordAnthropicUsage } from "./cost-guard.js";

const THINKING_MODEL = "claude-sonnet-4-6";
const THINKING_BUDGET = 5000;   // tokens Claude can use to reason
const MAX_TOKENS = 6000;        // must be > THINKING_BUDGET

// Signals that suggest a post is pick-related but hard to parse
const COMPLEXITY_SIGNALS = [
  "sgp", "same game", "parlay", "leg", "legs",
  "ml", "rl", "f5", "first five", "first 5",
  "+", "−", "o/u", "pk", "pick em",
  "/", "–",  // common in shorthand like "o6.5/rl-1.5"
];

/** Returns true if a post looks like it contains picks but is complex enough to warrant extended thinking. */
export function isComplexPickPost(text: string): boolean {
  const lower = text.toLowerCase();
  const signalCount = COMPLEXITY_SIGNALS.filter((s) => lower.includes(s)).length;
  return signalCount >= 2 && text.length > 40;
}

export async function extractPicksWithThinking(text: string): Promise<ParsedPick[]> {
  // Extended thinking on Sonnet costs significantly more — estimate conservatively
  // Sonnet input: $3/1M, output: $15/1M, thinking counts as output
  const estimatedCost = (2000 / 1_000_000) * 3 + (THINKING_BUDGET / 1_000_000) * 15;
  await checkBudget(estimatedCost);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: THINKING_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: {
      type: "enabled",
      budget_tokens: THINKING_BUDGET,
    },
    system: `You are a sports betting data extraction specialist. You excel at parsing complex, shorthand, and ambiguous betting content from social media.

Extract every distinct betting pick from the given text and return them as a JSON array.

Each pick object must have:
- sport: "MLB" | "NBA" | "NFL" | "NCAAB" | "NCAAF" | "NHL" | "MMA" | "OTHER"
- marketType: "MONEYLINE" | "SPREAD" | "TOTAL" | "PLAYER_PROP" | "NRFI" | "YRFI" | "PARLAY" | "OTHER"
- betSide: "OVER" | "UNDER" | "HOME" | "AWAY" | "YES" | "NO" | null
- line: number | null
- odds: number | null (American format)
- playerName: string | null
- teams: string[]
- gameLabel: string | null
- normalizedLabel: string (human-readable, e.g. "Tatum Over 28.5 pts -110")
- evidenceText: string (exact excerpt supporting this pick)
- confidence: 0.0–1.0

Return ONLY a valid JSON array. No prose, no markdown.`,
    messages: [
      {
        role: "user",
        content: `Extract all betting picks from this text. Think carefully about shorthand, abbreviations, and implied context before extracting.\n\nTEXT:\n${text.slice(0, 3000)}`,
      },
    ],
  });

  // Record usage — thinking tokens are billed as output tokens
  await recordAnthropicUsage({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: (response.usage as Record<string, number>)
      .cache_creation_input_tokens,
    cache_read_input_tokens: (response.usage as Record<string, number>).cache_read_input_tokens,
  });

  // Content array has thinking blocks + text blocks — only parse the text block
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  try {
    const clean = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as Partial<ParsedPick>[];

    return parsed
      .filter(
        (p): p is ParsedPick =>
          typeof p.normalizedLabel === "string" &&
          typeof p.sport === "string" &&
          typeof p.marketType === "string" &&
          Array.isArray(p.teams)
      )
      .map((p) => ({
        sport: p.sport!,
        league: p.league,
        gameLabel: p.gameLabel,
        teams: p.teams!,
        playerName: p.playerName,
        marketType: p.marketType!,
        betSide: p.betSide,
        line: p.line,
        odds: p.odds,
        normalizedLabel: p.normalizedLabel!,
        evidenceText: p.evidenceText ?? text.slice(0, 200),
        confidence: typeof p.confidence === "number" ? p.confidence : 0.6,
      }));
  } catch {
    return [];
  }
}
