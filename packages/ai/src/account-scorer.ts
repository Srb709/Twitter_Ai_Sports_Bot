/**
 * AI account credibility scorer.
 * Replaces keyword matching in follower-hunter with Claude reasoning.
 * Given a Twitter profile, Claude decides if this is a real bettor worth following.
 * Uses Haiku with prompt caching — fast and cheap per call.
 */
import Anthropic from "anthropic";
import { checkBudget, estimateCost, recordAnthropicUsage } from "./cost-guard.js";

const SCORER_MODEL = "claude-haiku-4-5";

export interface AccountScore {
  score: number;      // 0.0–1.0 overall relevance/authenticity
  relevant: boolean;  // whether to follow
  reasoning: string;  // one sentence explanation
}

export interface AccountProfile {
  username: string;
  bio: string;
  followersCount?: number;
  followingCount?: number;
  recentTweets?: string[];
}

export async function scoreAccount(profile: AccountProfile): Promise<AccountScore> {
  await checkBudget(estimateCost("anthropic", 500, 120));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const lines = [
    `Username: @${profile.username}`,
    `Bio: ${profile.bio || "(no bio)"}`,
    profile.followersCount !== undefined ? `Followers: ${profile.followersCount.toLocaleString()}` : null,
    profile.followingCount !== undefined ? `Following: ${profile.followingCount.toLocaleString()}` : null,
  ].filter(Boolean);

  if (profile.recentTweets?.length) {
    lines.push(
      `Recent tweets:\n${profile.recentTweets
        .slice(0, 3)
        .map((t) => `  - ${t.slice(0, 120)}`)
        .join("\n")}`
    );
  }

  const response = await client.messages.create({
    model: SCORER_MODEL,
    max_tokens: 150,
    system: [
      {
        type: "text",
        text: `Score Twitter accounts for a sports betting content account deciding who to follow.

Return ONLY this JSON (no prose, no fences):
{ "score": 0.0–1.0, "relevant": true/false, "reasoning": "one concise sentence" }

Scoring guide:
- 0.8–1.0: Active bettor posting real picks, discussing lines, engaging in sports betting community
- 0.5–0.8: Sports fan or casual bettor, some betting content, seems real
- 0.2–0.5: Generic sports account, tangentially related
- 0.0–0.2: Bot, spam, crypto/NFT, forex, follow-for-follow, or completely irrelevant

Always relevant=false if: selling picks, "guaranteed wins", "DM for picks $$$", crypto/NFT, follow-back accounts, obvious bot (0 bio, 0 posts)
Always relevant=true if: score >= 0.65 and no red flags`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: lines.join("\n") }],
  });

  await recordAnthropicUsage({
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: (response.usage as Record<string, number>)
      .cache_creation_input_tokens,
    cache_read_input_tokens: (response.usage as Record<string, number>).cache_read_input_tokens,
  });

  const block = response.content[0];
  if (block.type !== "text") return { score: 0.3, relevant: false, reasoning: "" };

  try {
    const clean = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(clean) as AccountScore;
    return {
      score: typeof parsed.score === "number" ? Math.min(1, Math.max(0, parsed.score)) : 0.3,
      relevant: parsed.relevant ?? false,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return { score: 0.3, relevant: false, reasoning: "" };
  }
}
