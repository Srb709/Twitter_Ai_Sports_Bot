import Anthropic from "anthropic";
import OpenAI from "openai";
import type { TweetDraftInput, TweetType, ClusterSignal, ParsedPick } from "@sports-engine/shared";
import {
  TWEET_SYSTEM_PROMPT,
  buildTweetUserPrompt,
  PICK_EXTRACTION_SYSTEM_PROMPT,
  buildPickExtractionPrompt,
} from "./prompts.js";
import {
  checkBudget,
  estimateCost,
  recordAnthropicUsage,
  recordOpenAiUsage,
} from "./cost-guard.js";

export { getCurrentSpend } from "./cost-guard.js";

export interface GeneratedTweet {
  tweetType: TweetType;
  text: string;
  model: string;
  costUsd?: number;
}

// ─── Client factories ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

// ─── Low-level callers (budget-guarded) ──────────────────────────────────────

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  maxTokens = 300
): Promise<{ text: string; costUsd: number }> {
  // Rough estimate: system prompt ~400 tokens, user prompt ~200 tokens
  const estInput = 600;
  await checkBudget(estimateCost("anthropic", estInput, maxTokens));

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error(`Unexpected response type: ${block.type}`);

  const costUsd = await recordAnthropicUsage({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: (response.usage as Record<string, number>).cache_creation_input_tokens,
    cache_read_input_tokens: (response.usage as Record<string, number>).cache_read_input_tokens,
  });

  return { text: block.text.trim(), costUsd };
}

async function callOpenAi(
  system: string,
  user: string,
  model: string,
  maxTokens = 300
): Promise<{ text: string; costUsd: number }> {
  const estInput = 600;
  await checkBudget(estimateCost("openai", estInput, maxTokens));

  const client = getOpenAiClient();
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  const usage = resp.usage;

  let costUsd = 0;
  if (usage) {
    costUsd = await recordOpenAiUsage({
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
    });
  }

  return { text, costUsd };
}

function getProvider(): { provider: "anthropic" | "openai"; model: string } {
  const provider = (process.env.AI_PROVIDER ?? "anthropic") as "anthropic" | "openai";
  const model =
    process.env.AI_MODEL ?? (provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5");
  return { provider, model };
}

async function callAI(
  system: string,
  user: string,
  maxTokens = 300
): Promise<{ text: string; costUsd: number }> {
  const { provider, model } = getProvider();
  if (provider === "openai") return callOpenAi(system, user, model, maxTokens);
  return callAnthropic(system, user, model, maxTokens);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateSingleTweet(input: TweetDraftInput): Promise<GeneratedTweet> {
  const { model } = getProvider();
  const userPrompt = buildTweetUserPrompt(input);
  const { text, costUsd } = await callAI(TWEET_SYSTEM_PROMPT, userPrompt, 350);
  const trimmed = text.length > 280 ? text.slice(0, 279) + "…" : text;
  return { tweetType: input.tweetType, text: trimmed, model, costUsd };
}

export async function generateTweetBatch(
  clusters: ClusterSignal[],
  recentPicks: ParsedPick[]
): Promise<GeneratedTweet[]> {
  const { model } = getProvider();

  const tweetTypes: TweetType[] = [
    "MOST_BACKED",
    "PICK_OF_DAY",
    "NRFI_YRFI",
    "ENGAGEMENT_QUESTION",
    "POLL_STYLE",
    "PUBLIC_HEAVY",
    "FADE_ANGLE",
    "THREAD_STARTER",
  ];

  const results: GeneratedTweet[] = [];

  for (const tweetType of tweetTypes) {
    try {
      const tweet = await generateSingleTweet({ tweetType, clusters, picks: recentPicks, model });
      results.push(tweet);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("BUDGET_EXCEEDED")) {
        console.warn(`[ai] Budget cap hit — stopping batch after ${results.length} tweets.`);
        break;
      }
      console.error(`[ai] Failed to generate ${tweetType}:`, msg);
    }
  }

  return results;
}

export async function aiExtractPicks(text: string): Promise<ParsedPick[]> {
  try {
    const userPrompt = buildPickExtractionPrompt(text);
    const { text: raw } = await callAI(PICK_EXTRACTION_SYSTEM_PROMPT, userPrompt, 800);

    const match = raw.match(/\[[\s\S]*\]/);
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
        confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
      }));
  } catch {
    return [];
  }
}

export {
  TWEET_SYSTEM_PROMPT,
  buildTweetUserPrompt,
  PICK_EXTRACTION_SYSTEM_PROMPT,
  buildPickExtractionPrompt,
} from "./prompts.js";
