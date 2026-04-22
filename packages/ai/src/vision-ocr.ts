/**
 * Claude Vision OCR fallback.
 * Called when Tesseract returns low confidence (< 0.6) or empty text.
 * Claude reads bet slip images far better than Tesseract:
 * overlapping text, dark backgrounds, odd fonts, handwritten lines — all handled.
 * Returns both raw text AND structured picks in a single call (one API round-trip).
 */
import Anthropic from "anthropic";
import fs from "fs/promises";
import path from "path";
import { checkBudget, estimateCost, recordAnthropicUsage } from "./cost-guard.js";

const VISION_MODEL = "claude-haiku-4-5";

export interface VisionOcrResult {
  text: string;
  confidence: number;
  picks: string[]; // plain-English pick summaries, e.g. "Tatum Over 28.5 pts -110"
}

export async function claudeVisionOcr(filePath: string): Promise<VisionOcrResult> {
  const imageBuffer = await fs.readFile(filePath);
  const base64 = imageBuffer.toString("base64");
  const mediaType = pathToMediaType(filePath);

  // Image tokens ≈ 1k–3k depending on size; budget conservatively
  await checkBudget(estimateCost("anthropic", 3000, 400));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 500,
    system: [
      {
        type: "text",
        text: `You read sports betting content from images — bet slips, screenshots, mobile app captures.

Extract all visible text and identify every betting pick shown.

Return ONLY this JSON (no prose, no markdown fences):
{
  "text": "all visible text from the image verbatim",
  "confidence": 0.0–1.0,
  "picks": ["Tatum Over 28.5 pts -110", "NRFI Yankees-Red Sox +105"]
}

confidence: 0.9+ = clear image, 0.6–0.9 = partially readable, < 0.6 = poor quality.
picks: empty array [] if no betting content. Each pick in plain English with line and odds if visible.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: "Read this image and extract all betting content." },
        ],
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
  if (block.type !== "text") return { text: "", confidence: 0, picks: [] };

  try {
    // Strip any accidental markdown fences before parsing
    const clean = block.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(clean) as { text: string; confidence: number; picks: string[] };
    return {
      text: parsed.text ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
      picks: Array.isArray(parsed.picks) ? parsed.picks : [],
    };
  } catch {
    // JSON parse failed — treat entire response as text
    return { text: block.text.trim(), confidence: 0.4, picks: [] };
  }
}

function pathToMediaType(
  filePath: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
