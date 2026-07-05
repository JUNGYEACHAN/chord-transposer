import sharp from "sharp";
import type { PreprocessedImage } from "../images/preprocess-for-ocr";
import { dedupeOcrWords } from "./dedupe-words";
import type { OcrProvider, OcrWord } from "./types";

const TILE_HEIGHT = 1100;
const TILE_OVERLAP = 180;

interface TiledOcrResult {
  words: OcrWord[];
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  tileCount: number;
}

/** OCR tall lead sheets in overlapping vertical tiles so the bottom is not missed. */
export async function recognizeTiledImage(
  provider: OcrProvider,
  preprocessed: PreprocessedImage,
  engine = "2",
): Promise<TiledOcrResult> {
  const { buffer, processedWidth, processedHeight, mimeType } = preprocessed;

  if (processedHeight <= 1300) {
    const result = await provider.recognize(buffer, mimeType, engine);
    return {
      words: result.words,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      rawText: result.rawText,
      tileCount: 1,
    };
  }

  const allWords: OcrWord[] = [];
  const texts: string[] = [];
  let tileCount = 0;

  for (let top = 0; top < processedHeight; top += TILE_HEIGHT - TILE_OVERLAP) {
    const height = Math.min(TILE_HEIGHT, processedHeight - top);
    tileCount += 1;

    const tileBuffer = await sharp(buffer)
      .extract({ left: 0, top, width: processedWidth, height })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    const result = await provider.recognize(tileBuffer, "image/jpeg", engine);
    texts.push(result.rawText);

    for (const word of result.words) {
      allWords.push({ ...word, top: word.top + top });
    }

    if (top + height >= processedHeight) break;
  }

  return {
    words: dedupeOcrWords(allWords),
    imageWidth: processedWidth,
    imageHeight: processedHeight,
    rawText: texts.join("\n"),
    tileCount,
  };
}
