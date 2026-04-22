import path from "path";
import fs from "fs/promises";
import { runOcr } from "@sports-engine/ocr";
import { db } from "@sports-engine/db";
import { cleanOcrText } from "@sports-engine/shared";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "data/media";

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

      const result = await runOcr(filePath);
      const cleaned = cleanOcrText(result.text);

      await db.sourceMedia.update({
        where: { id: media.id },
        data: {
          ocrStatus: "DONE",
          ocrText: cleaned,
          ocrConfidence: result.confidence,
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
  // Already downloaded
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
