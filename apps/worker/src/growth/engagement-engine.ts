/**
 * Likes and replies to posts in the betting niche.
 * Replies are AI-generated, short, unique each time — Grok can't fingerprint them.
 * Never likes or replies to the same post twice.
 */
import type { Page } from "playwright";
import Anthropic from "anthropic";
import { db } from "@sports-engine/db";
import { canAct, recordAction } from "./action-budget.js";
import { humanClick, humanDelay, humanScroll, humanType, organicBrowse } from "./human-behavior.js";
import { checkBudget, estimateCost, recordAnthropicUsage } from "@sports-engine/ai";

const REPLY_MODEL = "claude-haiku-4-5";

// Hashtags and search terms to browse for engagement opportunities
const ENGAGEMENT_TARGETS = [
  "#MLBpicks",
  "#NBApicks",
  "#sportsbetting",
  "#bettingtips",
  "#NRFI",
  "#freepicks",
  "#sharpaction",
];

export async function runEngagementEngine(page: Page): Promise<{ likes: number; replies: number }> {
  const results = { likes: 0, replies: 0 };

  const target = ENGAGEMENT_TARGETS[Math.floor(Math.random() * ENGAGEMENT_TARGETS.length)];
  console.log(`[engagement] Browsing ${target}`);

  try {
    // Search for the target hashtag/term
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(target)}&f=live`;
    await page.goto(searchUrl, { waitUntil: "networkidle" });
    await humanDelay(2500, 600);

    // Organic scroll to load posts and look natural
    await organicBrowse(page, 5000);

    const articles = await page.$$('article[data-testid="tweet"]');

    for (const article of articles.slice(0, 15)) {
      // Randomly skip some posts — humans don't engage with everything
      if (Math.random() < 0.4) continue;

      try {
        const postKey = await extractPostKey(article);
        if (!postKey) continue;

        // Like the post
        if (await canAct("LIKE") && !(await alreadyDid("LIKE", postKey))) {
          const likeBtn = await article.$('[data-testid="like"]');
          if (likeBtn) {
            await humanMouseMove(article, likeBtn);
            await humanDelay(300, 100);
            await likeBtn.click();
            await humanDelay(800, 200);

            await recordAction({ type: "LIKE", targetPostKey: postKey });
            results.likes++;

            // Gap between likes: 5-20 seconds
            await humanDelay(11000, 5000);
          }
        }

        // Maybe reply (less frequently than likes — looks more natural)
        if (
          await canAct("REPLY") &&
          !(await alreadyDid("REPLY", postKey)) &&
          Math.random() < 0.25
        ) {
          const postText = await article.$eval(
            '[data-testid="tweetText"]',
            (el) => el.textContent ?? ""
          ).catch(() => "");

          if (postText.length < 10) continue;

          const reply = await generateReply(postText);
          if (!reply) continue;

          // Click reply button
          const replyBtn = await article.$('[data-testid="reply"]');
          if (!replyBtn) continue;

          await replyBtn.click();
          await humanDelay(1500, 400);

          // Type into the reply box
          const replyBox = await page.$('[data-testid="tweetTextarea_0"]');
          if (!replyBox) continue;

          await humanType(page, '[data-testid="tweetTextarea_0"]', reply);
          await humanDelay(800, 300);

          // Submit
          const submitBtn = await page.$('[data-testid="tweetButtonInline"]');
          if (submitBtn) {
            await submitBtn.click();
            await humanDelay(2000, 500);

            const username = await article.$eval(
              'a[href^="/"] [dir="ltr"]',
              (el) => el.textContent ?? ""
            ).catch(() => undefined);

            await recordAction({
              type: "REPLY",
              targetPostKey: postKey,
              targetUsername: username,
              replyText: reply,
            });
            results.replies++;

            // Longer gap after replying — don't spam
            await humanDelay(30000, 10000);
          }
        }

        // Organic pause between posts
        await humanScroll(page, 300);
        await humanDelay(2000, 800);

      } catch {
        // Non-fatal per-post error
      }
    }
  } catch (err) {
    console.error("[engagement] Error:", err);
  }

  return results;
}

async function generateReply(postText: string): Promise<string | null> {
  try {
    await checkBudget(estimateCost("anthropic", 300, 60));

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await client.messages.create({
      model: REPLY_MODEL,
      max_tokens: 60,
      system: [
        {
          type: "text",
          text: `You write short, natural replies to sports betting tweets.
Sound like a real bettor texting a friend — casual, direct, sometimes a hot take.
Rules: under 25 words. No emojis. No hashtags. No "great post" filler.
Vary your style every time. Sometimes agree, sometimes push back slightly, sometimes add a quick stat or angle.
Never mention you're an AI. Output only the reply text, nothing else.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: `Reply to this betting tweet: "${postText.slice(0, 200)}"` },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") return null;

    await recordAnthropicUsage({
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: (response.usage as Record<string, number>).cache_creation_input_tokens,
      cache_read_input_tokens: (response.usage as Record<string, number>).cache_read_input_tokens,
    });

    return block.text.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.startsWith("BUDGET_EXCEEDED")) {
      console.error("[engagement] Reply generation failed:", msg);
    }
    return null;
  }
}

async function alreadyDid(type: "LIKE" | "REPLY", postKey: string): Promise<boolean> {
  const existing = await db.growthAction.findFirst({
    where: { actionType: type, targetPostKey: postKey, success: true },
  });
  return !!existing;
}

async function extractPostKey(article: Awaited<ReturnType<Page["$"]>>): Promise<string | null> {
  if (!article) return null;
  try {
    const href = await article.$eval(
      'a[href*="/status/"]',
      (el) => el.getAttribute("href") ?? ""
    );
    const match = href.match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function humanMouseMove(
  article: Awaited<ReturnType<Page["$"]>>,
  btn: Awaited<ReturnType<Page["$"]>>
): Promise<void> {
  if (!btn) return;
  try {
    const box = await btn.boundingBox();
    if (!box) return;
    const x = box.x + box.width / 2 + (Math.random() * 6 - 3);
    const y = box.y + box.height / 2 + (Math.random() * 4 - 2);
    const p = (article as unknown as { page: () => Page }).page?.();
    if (p) await p.mouse.move(Math.round(x), Math.round(y));
  } catch {
    // ignore
  }
}
