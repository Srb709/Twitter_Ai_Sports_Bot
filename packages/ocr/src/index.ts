import tesseract from 'node-tesseract-ocr';
import sharp from 'sharp';
import { cleanOcrText } from '@sports-engine/shared';
import * as fs from 'fs';
import * as path from 'path';

export interface OcrResult {
  text: string;
  confidence: number;
  rawText: string;
}

export interface OcrConfig {
  lang?: string;
  oem?: number;
  psm?: number;
}

const DEFAULT_CONFIG: OcrConfig = { lang: 'eng', oem: 1, psm: 6 };

/**
 * Pre-process the image for better OCR accuracy:
 * - convert to grayscale
 * - normalise contrast
 * - apply mild sharpening
 * - upscale to at least 1600 px wide (Tesseract works best at ~300 DPI)
 */
async function preprocessImage(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath);
  const outPath = inputPath.replace(ext, `.ocr-prep${ext}`);
  await sharp(inputPath)
    .grayscale()
    .normalize()
    .sharpen()
    .resize({ width: 1600, withoutEnlargement: false })
    .toFile(outPath);
  return outPath;
}

/**
 * Heuristic confidence estimate based on OCR output quality.
 * Returns a value in [0.1, 0.95].
 */
function estimateConfidence(rawText: string, cleaned: string): number {
  if (!cleaned || cleaned.length < 5) return 0.1;
  const ratio = cleaned.length / Math.max(rawText.length, 1);
  // Count characters that look like OCR noise
  const noiseChars = (rawText.match(/[^a-zA-Z0-9\s.,:%+\-\/()'"@#$!?]/g) ?? []).length;
  const noisePenalty = Math.min(noiseChars / Math.max(rawText.length, 1), 0.5);
  return Math.max(0.1, Math.min(0.95, ratio * (1 - noisePenalty)));
}

/**
 * Run Tesseract OCR on an image file.
 * The image is pre-processed for better results and the temp file is cleaned up.
 */
export async function runOcr(imagePath: string, config?: OcrConfig): Promise<OcrResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let prepPath: string | null = null;
  try {
    prepPath = await preprocessImage(imagePath);
    const rawText: string = await tesseract.recognize(prepPath, {
      lang: cfg.lang,
      oem: cfg.oem,
      psm: cfg.psm,
    });
    const text = cleanOcrText(rawText);
    const confidence = estimateConfidence(rawText, text);
    return { text, confidence, rawText };
  } finally {
    if (prepPath && fs.existsSync(prepPath)) {
      fs.unlinkSync(prepPath);
    }
  }
}

/**
 * Run OCR on an in-memory image buffer.
 * Writes the buffer to a temp file, runs OCR, and cleans up.
 */
export async function runOcrOnBuffer(buffer: Buffer, config?: OcrConfig): Promise<OcrResult> {
  const tmp = path.join('/tmp', `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await runOcr(tmp, config);
  } finally {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  }
}

/**
 * Batch-process a list of image paths. Returns results in the same order,
 * with failed images represented by a result with confidence 0 and empty text.
 */
export async function runOcrBatch(
  imagePaths: string[],
  config?: OcrConfig,
): Promise<OcrResult[]> {
  const results: OcrResult[] = [];
  for (const imgPath of imagePaths) {
    try {
      const result = await runOcr(imgPath, config);
      results.push(result);
    } catch (err) {
      console.error(`[ocr] Failed on ${imgPath}:`, err);
      results.push({ text: '', confidence: 0, rawText: '' });
    }
  }
  return results;
}
