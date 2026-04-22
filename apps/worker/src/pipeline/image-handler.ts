import path from "path";
import fs from "fs/promises";
import { runOcr } from "@sports-engine/ocr";
import { claudeVisionOcr } from "@sports-engine/ai";
import { db } from "@sports-engine/db";
import { cleanOcrText } from "@sports-engine/shared";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "data/media";
const VISION_CONFIDENCE_THRESHOLD = 0.6; // below this, escalate to Claude Vision

export async function processImages(): Promise<number> {
  const pending = await db.sourceMedia.findMany({
    where: { ocrStatus: "PENDING", ocrNeeded: true },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) return 0;

  let processed = 0;

  for (const media of pending) {
    await db.sourceMedia.update({
      where: { id: media.id },
      data: { ocrStatus: "PROCESSING" },
    });

    try {
      const filePath = await resolveFile(media);

      if (!filePath) {
        await db.sourceMedia.update({
          where: { id: media.id },
          data: { ocrStatus: "SKIPPED" },
        });
        continue;
      }

      // Step 1: Tesseract (free, fast)
      const tesseractResult = await runOcr(filePath);
      let ocrText = cleanOcrText(tesseractResult.text);
      let confidence = tesseractResult.confidence;
      let visionPicks: string[] = [];

      // Step 2: Claude Vision fallback if Tesseract struggled
      if (confidence < VISION_CONFIDENCE_THRESHOLD || ocrText.length < 20) {
        console.log(
          `[image-handler] Tesseract low confidence (${confidence.toFixed(2)}) on ${media.id} — escalating to Claude Vision`
        );
        try {
          const visionResult = await claudeVisionOcr(filePath);
          // Use Vision result if it got better text
          if (visionResult.text.length > ocrText.length || visionResult.confidence > confidence) {
            ocrText = visionResult.text;
            confidence = visionResult.confidence;
          }
          visionPicks = visionResult.picks;
        } catch (visionErr) {
          const msg = visionErr instanceof Error ? visionErr.message : String(visionErr);
          if (!msg.startsWith("BUDGET_EXCEEDED")) {
            console.warn(`[image-handler] Claude Vision failed: ${msg}`);
          }
        }
      }

      // Append vision-extracted picks to the text so the pick-extractor sees them
      const finalText = visionPicks.length
        ? `${ocrText}\n\n[VISION PICKS]\n${visionPicks.join("\n")}`
        : ocrText;

      await db.sourceMedia.update({
        where: { id: media.id },
        data: {
          ocrStatus: "DONE",
          ocrText: finalText,
          ocrConfidence: confidence,
          filePath,
        },
      });

      processed++;
    } catch (err) {
      console.error(`[image-handler] OCR failed for media ${media.id}:`, err);
      await db.sourceMedia.update({
        where: { id: media.id },
        data: { ocrStatus: "FAILED" },
      });
    }
  }

  return processed;
}

async function resolveFile(media: {
  id: string;
  filePath: string | null;
  mediaUrl: string | null;
  sourcePostId: string;
}): Promise<string | null> {
  if (media.filePath) {
    try {
      await fs.access(media.filePath);
      return media.filePath;
    } catch {
      // fall through to download
    }
  }

  if (!media.mediaUrl) return null;

  try {
    const dir = path.join(MEDIA_DIR, media.sourcePostId);
    await fs.mkdir(dir, { recursive: true });

    const ext = guessExtension(media.mediaUrl);
    const dest = path.join(dir, `${media.id}${ext}`);

    const resp = await fetch(media.mediaUrl);
    if (!resp.ok) return null;

    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(dest, buf);

    await db.sourceMedia.update({ where: { id: media.id }, data: { filePath: dest } });
    return dest;
  } catch {
    return null;
  }
}

function guessExtension(url: string): string {
  const clean = url.split("?")[0];
  if (clean.endsWith(".png")) return ".png";
  if (clean.endsWith(".gif")) return ".gif";
  if (clean.endsWith(".webp")) return ".webp";
  return ".jpg";
}
