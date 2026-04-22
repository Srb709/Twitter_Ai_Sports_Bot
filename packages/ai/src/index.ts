import Anthropic from 'anthropic';
import OpenAI from 'openai';
import type { TweetDraftInput, TweetType, ClusterSignal, ParsedPick } from '@sports-engine/shared';
import {
  TWEET_SYSTEM_PROMPT,
  buildTweetUserPrompt,
  PICK_EXTRACTION_SYSTEM_PROMPT,
  buildPickExtractionPrompt,
} from './prompts.js';

export interface GeneratedTweet {
  tweetType: TweetType;
  text: string;
  model: string;
}

// ─── Client factories ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  return new Anthropic({ apiKey });
}

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
  return new OpenAI({ apiKey });
}

// ─── Low-level call helpers ───────────────────────────────────────────────────

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  maxTokens = 300,
): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error(`Unexpected Anthropic response block type: ${block.type}`);
  return block.text.trim();
}

async function callOpenAi(
  system: string,
  user: string,
  model: string,
  maxTokens = 300,
): Promise<string> {
  const client = getOpenAiClient();
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Route an AI call to the configured provider.
 * Uses AI_PROVIDER and AI_MODEL env vars; falls back to Anthropic / claude-haiku-4-5.
 */
async function callAI(
  system: string,
  user: string,
  maxTokens = 300,
): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? 'anthropic';
  const model =
    process.env.AI_MODEL ??
    (provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5');

  if (provider === 'openai') {
    return callOpenAi(system, user, model, maxTokens);
  }
  return callAnthropic(system, user, model, maxTokens);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a single tweet for a given type and cluster/pick data.
 * Truncates to 280 chars if the model overshoots.
 */
export async function generateSingleTweet(input: TweetDraftInput): Promise<GeneratedTweet> {
  const userPrompt = buildTweetUserPrompt(input);
  const text = await callAI(TWEET_SYSTEM_PROMPT, userPrompt, 350);
  const model = process.env.AI_MODEL ?? 'claude-haiku-4-5';

  // Hard truncation guard — the prompt instructs the model to stay under 280,
  // but we protect against edge cases.
  const trimmed = text.length > 280 ? text.slice(0, 279) + '…' : text;

  return { tweetType: input.tweetType, text: trimmed, model };
}

/**
 * Generate a full batch of tweet drafts — one per tweet type — for a content cycle.
 * Failures for individual types are caught and logged; the batch continues.
 */
export async function generateTweetBatch(
  clusters: ClusterSignal[],
  recentPicks: ParsedPick[],
): Promise<GeneratedTweet[]> {
  const model = process.env.AI_MODEL ?? 'claude-haiku-4-5';

  const tweetTypes: TweetType[] = [
    'MOST_BACKED',
    'PICK_OF_DAY',
    'NRFI_YRFI',
    'ENGAGEMENT_QUESTION',
    'POLL_STYLE',
    'PUBLIC_HEAVY',
    'FADE_ANGLE',
    'THREAD_STARTER',
  ];

  const results: GeneratedTweet[] = [];

  for (const tweetType of tweetTypes) {
    try {
      const tweet = await generateSingleTweet({
        tweetType,
        clusters,
        picks: recentPicks,
        model,
      });
      results.push(tweet);
    } catch (err) {
      console.error(`[ai] Failed to generate ${tweetType}:`, err);
    }
  }

  return results;
}

/**
 * Use AI to supplement regex-based pick extraction.
 * Returns an empty array on any failure so callers can degrade gracefully.
 */
export async function aiExtractPicks(text: string): Promise<ParsedPick[]> {
  try {
    const userPrompt = buildPickExtractionPrompt(text);
    const raw = await callAI(PICK_EXTRACTION_SYSTEM_PROMPT, userPrompt, 800);

    // Find the JSON array in the response — model may include stray prose
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as Partial<ParsedPick>[];

    // Validate and coerce each entry — drop malformed ones
    return parsed.filter((p): p is ParsedPick => {
      return (
        typeof p.normalizedLabel === 'string' &&
        typeof p.sport === 'string' &&
        typeof p.marketType === 'string' &&
        Array.isArray(p.teams)
      );
    }).map((p) => ({
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
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
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
} from './prompts.js';
