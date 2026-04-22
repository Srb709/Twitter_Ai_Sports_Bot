/**
 * Tweet self-critique loop.
 * After generating a tweet, Claude reads it back and scores it against the account's
 * voice rules. Anything below 7/10 gets rewritten automatically.
 * You only ever see polished drafts in the approval queue.
 */
import Anthropic from "anthropic";
import { checkBudget, estimateCost, recordAnthropicUsage } from "./cost-guard.js";

const REFINE_MODEL = "claude-haiku-4-5";
const REWRITE_THRESHOLD = 7;

export interface RefinementResult {
  finalText: string;
  score: number;        // 1–10
  wasRewritten: boolean;
  reasoning: string;   // one sentence on what was wrong / why it passed
}

export async function refineTweet(
  originalText: string,
  tweetType: string
): Promise<RefinementResult> {
  // Critique + optional rewrite in one call (~500 input, ~200 output)
  await checkBudget(estimateCost("anthropic", 500, 200));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: REFINE_MODEL,
    max_tokens: 350,
    system: [
      {
        type: "text",
        text: `You are a quality reviewer for a sports betting Twitter account.
Score the tweet and rewrite it if it scores below ${REWRITE_THRESHOLD}.

Scoring rubric (total 10 pts):
- Voice (0–3): sounds like a real bettor texting a friend, not a brand or robot
- Punch (0–3): direct, decisive, no hedging words like "might", "could", "possibly"
- Clarity (0–2): one clear message, no run-on structure, tight word choice
- Rules (0–2): no em dashes, no "lock/guaranteed/sure thing/can't miss", no hashtags, ≤280 chars

Return ONLY this JSON:
{
  "score": 1–10,
  "reasoning": "one sentence explaining the score",
  "rewrite": "improved tweet text if score < ${REWRITE_THRESHOLD}, otherwise null"
}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Tweet type: ${tweetType}\n\nDraft tweet:\n"${originalText}"`,
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
  if (block.type !== "text") {
    return { finalText: originalText, score: 5, wasRewritten: false, reasoning: "" };
  }

  try {
    const clean = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(clean) as {
      score: number;
      reasoning: string;
      rewrite: string | null;
    };

    const score = typeof parsed.score === "number" ? Math.round(parsed.score) : 5;
    const wasRewritten = score < REWRITE_THRESHOLD && typeof parsed.rewrite === "string";
    let finalText = wasRewritten ? parsed.rewrite! : originalText;

    // Hard length guard
    if (finalText.length > 280) finalText = finalText.slice(0, 279) + "…";

    return {
      finalText,
      score,
      wasRewritten,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return { finalText: originalText, score: 5, wasRewritten: false, reasoning: "" };
  }
}
