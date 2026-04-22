/**
 * Core post-collection engine.
 *
 * Strategy:
 *   1. Intercept X's internal GraphQL responses (UserTweets endpoint) to get
 *      structured tweet data without DOM parsing.
 *   2. Fall back to DOM parsing of <article> elements when the GraphQL
 *      interception produces no results.
 *   3. Scroll the page multiple times, stopping early if no new posts appear
 *      in two consecutive scroll cycles.
 *   4. Download media files and screenshot tweet cards for OCR processing.
 */

import type { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { randomDelay, sleep, extractTweetId, sha256 } from '@sports-engine/shared';
import type { RawPost } from '@sports-engine/shared';

// ─── GraphQL Response Parsing ─────────────────────────────────────────────────

interface XTweetLegacy {
  full_text?: string;
  id_str?: string;
  created_at?: string;
  entities?: {
    media?: Array<{ media_url_https: string; type: string }>;
    urls?: Array<{ expanded_url: string }>;
  };
  extended_entities?: {
    media?: Array<{ media_url_https: string; type: string }>;
  };
}

interface XTweetResult {
  rest_id?: string;
  legacy?: XTweetLegacy;
  core?: {
    user_results?: {
      result?: {
        legacy?: { screen_name?: string };
      };
    };
  };
}

/**
 * Recursively walk an unknown JSON value and collect all tweet result objects
 * that look like X tweet nodes (have `legacy.id_str`).
 */
function extractTweetsFromGraphQL(value: unknown, results: XTweetResult[] = []): XTweetResult[] {
  if (!value || typeof value !== 'object') return results;

  if (Array.isArray(value)) {
    for (const item of value) {
      extractTweetsFromGraphQL(item, results);
    }
    return results;
  }

  const obj = value as Record<string, unknown>;

  // Check if this node looks like a tweet_results.result
  if (obj['__typename'] === 'Tweet' || (obj['legacy'] && (obj['legacy'] as Record<string, unknown>)['id_str'])) {
    results.push(obj as unknown as XTweetResult);
    return results;
  }

  for (const key of Object.keys(obj)) {
    extractTweetsFromGraphQL(obj[key], results);
  }

  return results;
}

function tweetResultToRawPost(tweet: XTweetResult, username: string): RawPost | null {
  const legacy = tweet.legacy;
  if (!legacy?.id_str && !tweet.rest_id) return null;

  const tweetId = legacy?.id_str ?? tweet.rest_id ?? '';
  if (!tweetId) return null;

  const authorHandle =
    tweet.core?.user_results?.result?.legacy?.screen_name?.toLowerCase() ??
    username.toLowerCase();

  const url = `https://x.com/${authorHandle}/status/${tweetId}`;
  const postKey = tweetId;
  const text = legacy?.full_text ?? '';

  const postedAt = legacy?.created_at ? new Date(legacy.created_at) : undefined;

  // Prefer extended_entities (has videos + images), fall back to entities
  const mediaEntities =
    legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const mediaUrls = mediaEntities
    .filter((m) => m.type === 'photo' || m.type === 'animated_gif')
    .map((m) => m.media_url_https);

  return {
    id: tweetId,
    url,
    postKey,
    text,
    authorHandle,
    postedAt,
    mediaUrls,
    rawJson: tweet,
  };
}

// ─── DOM Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse tweet data from article DOM elements as a fallback when GraphQL
 * interception yields no results.
 */
async function parseTweetsFromDom(page: Page, username: string): Promise<RawPost[]> {
  try {
    const posts = await page.evaluate((authorUsername: string) => {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      const results: Array<{
        id: string;
        url: string;
        postKey: string;
        text: string;
        authorHandle: string;
        postedAt?: string;
        mediaUrls: string[];
      }> = [];

      for (const article of articles) {
        // Extract tweet text
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? (textEl as HTMLElement).innerText.trim() : '';

        // Extract tweet URL and ID from status links
        const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]'));
        let tweetUrl = '';
        let tweetId = '';
        for (const link of statusLinks) {
          const href = (link as HTMLAnchorElement).href;
          const match = href.match(/\/status\/(\d+)/);
          if (match) {
            tweetId = match[1];
            tweetUrl = href.startsWith('http') ? href : `https://x.com${href}`;
            break;
          }
        }

        if (!tweetId) continue;

        // Extract media image URLs
        const imgEls = Array.from(article.querySelectorAll('img[src*="twimg.com/media"]'));
        const mediaUrls = [...new Set(imgEls.map((img) => (img as HTMLImageElement).src))];

        // Extract timestamp
        const timeEl = article.querySelector('time[datetime]');
        const postedAt = timeEl ? (timeEl as HTMLTimeElement).getAttribute('datetime') ?? undefined : undefined;

        // Extract author handle from links
        const profileLinks = Array.from(
          article.querySelectorAll('a[href^="/"][href*="/"]'),
        );
        let authorHandle = authorUsername.toLowerCase();
        for (const link of profileLinks) {
          const href = (link as HTMLAnchorElement).pathname;
          if (href && !href.includes('/status/') && !href.includes('/photo/') && href.length > 1) {
            const handle = href.replace(/^\//, '').split('/')[0];
            if (handle && /^[a-zA-Z0-9_]{1,50}$/.test(handle)) {
              authorHandle = handle.toLowerCase();
              break;
            }
          }
        }

        results.push({
          id: tweetId,
          url: tweetUrl,
          postKey: tweetId,
          text,
          authorHandle,
          postedAt,
          mediaUrls,
        });
      }

      return results;
    }, username);

    return posts.map((p) => ({
      ...p,
      postedAt: p.postedAt ? new Date(p.postedAt) : undefined,
    }));
  } catch (err) {
    console.warn('[post-collector] DOM parsing error:', err);
    return [];
  }
}

// ─── Media Download ───────────────────────────────────────────────────────────

/**
 * Download an image from a URL and save it to destDir.
 * Returns the absolute local path on success, null on failure.
 */
export async function downloadMedia(mediaUrl: string, destDir: string): Promise<string | null> {
  try {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Derive a stable filename from the URL
    const urlHash = crypto.createHash('md5').update(mediaUrl).digest('hex').slice(0, 12);
    const ext = mediaUrl.includes('.jpg') ? '.jpg' : mediaUrl.includes('.png') ? '.png' : '.jpg';
    const filename = `${urlHash}${ext}`;
    const destPath = path.join(destDir, filename);

    // Skip if already downloaded
    if (fs.existsSync(destPath)) return destPath;

    // Append format query if this is a twimg.com URL (gets original resolution)
    const fetchUrl = mediaUrl.includes('twimg.com/media') && !mediaUrl.includes('?format=')
      ? `${mediaUrl}?format=jpg&name=large`
      : mediaUrl;

    await new Promise<void>((resolve, reject) => {
      const protocol = fetchUrl.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      const req = protocol.get(fetchUrl, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`HTTP ${res.statusCode} for ${fetchUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      });

      req.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });

      req.setTimeout(15_000, () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
    });

    return destPath;
  } catch (err) {
    console.warn(`[post-collector] Failed to download ${mediaUrl}:`, err);
    return null;
  }
}

/**
 * Screenshot a single tweet article element and save as a PNG.
 * Returns the absolute local path on success, null on failure.
 */
export async function screenshotTweetCard(
  page: Page,
  articleElement: import('playwright').ElementHandle,
  destDir: string,
  postKey: string,
): Promise<string | null> {
  try {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, `${postKey}.png`);
    if (fs.existsSync(destPath)) return destPath;

    await articleElement.screenshot({ path: destPath, type: 'png' });
    return destPath;
  } catch (err) {
    console.warn(`[post-collector] Screenshot failed for ${postKey}:`, err);
    return null;
  }
}

// ─── Main Collection Function ─────────────────────────────────────────────────

/**
 * Collect posts from a single X account.
 *
 * Navigates to the account profile, intercepts GraphQL responses, and also
 * falls back to DOM parsing. Scrolls the page up to `maxScrolls` times,
 * collecting posts on each cycle.
 */
export async function collectPostsFromAccount(
  page: Page,
  username: string,
  options: { maxScrolls: number; knownPostKeys: Set<string> },
): Promise<RawPost[]> {
  const { maxScrolls, knownPostKeys } = options;
  const collectedPosts: Map<string, RawPost> = new Map();
  const graphqlPosts: Map<string, RawPost> = new Map();

  // ── Set up GraphQL response interception ────────────────────────────────────
  page.on('response', async (response) => {
    const url = response.url();
    if (
      !url.includes('UserTweets') &&
      !url.includes('UserMedia') &&
      !url.includes('HomeTimeline') &&
      !url.includes('TweetDetail')
    ) {
      return;
    }

    try {
      const body = await response.text();
      const json = JSON.parse(body) as unknown;
      const tweets = extractTweetsFromGraphQL(json);

      for (const tweet of tweets) {
        const post = tweetResultToRawPost(tweet, username);
        if (post && post.postKey && !knownPostKeys.has(post.postKey)) {
          graphqlPosts.set(post.postKey, post);
        }
      }
    } catch {
      // JSON parse failure is expected for non-JSON responses — ignore
    }
  });

  // ── Navigate to the profile page ────────────────────────────────────────────
  const profileUrl = `https://x.com/${username}`;
  console.log(`[post-collector] Navigating to ${profileUrl}`);

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    console.warn(`[post-collector] Navigation warning for ${username}:`, err);
  }

  await randomDelay(2000, 4000);

  // ── Scroll and collect ───────────────────────────────────────────────────────
  let consecutiveEmptyScrolls = 0;

  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    // Harvest DOM posts on this scroll position
    const domPosts = await parseTweetsFromDom(page, username);
    let newInThisCycle = 0;

    // Merge DOM posts
    for (const post of domPosts) {
      if (!knownPostKeys.has(post.postKey) && !collectedPosts.has(post.postKey)) {
        collectedPosts.set(post.postKey, post);
        newInThisCycle++;
      }
    }

    // Merge intercepted GraphQL posts
    for (const [key, post] of graphqlPosts.entries()) {
      if (!knownPostKeys.has(key) && !collectedPosts.has(key)) {
        collectedPosts.set(key, post);
        newInThisCycle++;
      }
    }

    console.log(
      `[post-collector] ${username} scroll ${scroll + 1}/${maxScrolls} — ` +
        `${newInThisCycle} new (total ${collectedPosts.size})`,
    );

    if (newInThisCycle === 0) {
      consecutiveEmptyScrolls++;
      if (consecutiveEmptyScrolls >= 2) {
        console.log(`[post-collector] No new posts for 2 scrolls — stopping early`);
        break;
      }
    } else {
      consecutiveEmptyScrolls = 0;
    }

    // Scroll down
    const scrollAmount = 500 + Math.floor(Math.random() * 500);
    await page.evaluate((amount: number) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);

    await randomDelay(1500, 3000);
  }

  // Merge any final GraphQL-intercepted posts that haven't been merged yet
  for (const [key, post] of graphqlPosts.entries()) {
    if (!knownPostKeys.has(key) && !collectedPosts.has(key)) {
      collectedPosts.set(key, post);
    }
  }

  console.log(
    `[post-collector] ${username}: collected ${collectedPosts.size} new posts`,
  );

  return Array.from(collectedPosts.values());
}
