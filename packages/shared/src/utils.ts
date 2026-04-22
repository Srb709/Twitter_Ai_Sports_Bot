import { createHash } from 'crypto';

import { TWEET_CHAR_LIMIT } from './constants.js';

/** Pause execution for `ms` milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pause for a random duration between minMs and maxMs */
export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(delay);
}

/** SHA-256 hex digest of a string — used for content deduplication */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Extract the numeric tweet/status ID from an X (Twitter) URL */
export function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  return match ? match[1] : null;
}

/** Normalize a Twitter handle: strip leading @, lowercase */
export function normalizeHandle(handle: string): string {
  return handle.replace(/^@+/, '').toLowerCase().trim();
}

/**
 * Clean raw OCR output:
 * - strip null bytes and control characters
 * - collapse runs of whitespace / newlines
 * - remove common OCR garbage sequences
 */
export function cleanOcrText(raw: string): string {
  return raw
    // remove null bytes and non-printable control chars (keep newlines/tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // common OCR artifacts: pipe characters used as 'I' or 'l', stray tildes
    .replace(/\|{2,}/g, ' ')
    // collapse multiple newlines into a single space
    .replace(/\n+/g, ' ')
    // collapse multiple spaces/tabs
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Convert American moneyline odds to decimal.
 * Examples: -110 → 1.909, +150 → 2.5
 */
export function americanToDecimal(american: number): number {
  if (american >= 0) {
    return +(1 + american / 100).toFixed(4);
  }
  return +(1 + 100 / Math.abs(american)).toFixed(4);
}

/**
 * Convert decimal odds to American moneyline.
 * Examples: 1.909 → -110, 2.5 → +150
 */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

/**
 * Trim text to fit within the 280-character tweet limit.
 * Attempts to break at the last word boundary before the limit.
 */
export function truncateToTweet(text: string): string {
  if (text.length <= TWEET_CHAR_LIMIT) return text;
  const sliced = text.slice(0, TWEET_CHAR_LIMIT - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const truncated = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return truncated + '…';
}

/**
 * Split an array into chunks of at most `size` elements.
 * Example: chunkArray([1,2,3,4,5], 2) → [[1,2],[3,4],[5]]
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('Chunk size must be > 0');
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
