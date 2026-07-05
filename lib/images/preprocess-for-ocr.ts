import sharp from "sharp";
import type { OcrWord } from "../ocr/types";

export interface PreprocessedImage {
  buffer: Buffer;
  mimeType: "image/jpeg";
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
}

/** Prepare a lead sheet for OCR.space (orient, enhance, resize, fit 1MB limit). */
export async function preprocessForOcr(
  buffer: Buffer,
  maxBytes = 1024 * 1024,
): Promise<PreprocessedImage> {
  const oriented = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const originalWidth = meta.width ?? 1200;
  const originalHeight = meta.height ?? 1600;

  let width = originalWidth;
  if (width > 2600) width = 2600;
  else if (width > 1800) width = 1800;

  let pipeline = oriented
    .resize({ width, withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 0.6 });

  let quality = 90;
  let output = await pipeline
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  while (output.data.length > maxBytes && quality > 52) {
    quality -= 10;
    output = await pipeline
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  }

  if (output.data.length > maxBytes) {
    output = await sharp(buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .normalize()
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  }

  return {
    buffer: output.data,
    mimeType: "image/jpeg",
    originalWidth,
    originalHeight,
    processedWidth: output.info.width,
    processedHeight: output.info.height,
  };
}

export function scaleOcrWordsToOriginal(
  words: OcrWord[],
  preprocessed: PreprocessedImage,
  ocrWidth: number,
  ocrHeight: number,
): OcrWord[] {
  if (ocrWidth <= 0 || ocrHeight <= 0) return words;

  const scaleX = preprocessed.originalWidth / ocrWidth;
  const scaleY = preprocessed.originalHeight / ocrHeight;

  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) {
    return words;
  }

  return words.map((word) => ({
    ...word,
    left: Math.round(word.left * scaleX),
    top: Math.round(word.top * scaleY),
    width: Math.max(1, Math.round(word.width * scaleX)),
    height: Math.max(1, Math.round(word.height * scaleY)),
  }));
}
