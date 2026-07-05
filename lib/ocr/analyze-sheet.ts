import { selectChordOcrWords } from "../chords/filter-ocr-words";
import { extractChordsFromOcr } from "../chords/harness";
import {
  extractChordHighlights,
  type ChordHighlight,
} from "../chords/highlights";
import type { DetectedChord } from "../chords/types";
import {
  preprocessForOcr,
  scaleOcrWordsToOriginal,
} from "../images/preprocess-for-ocr";
import { createOcrProvider } from "./index";
import type { OcrWord } from "./types";

function mergeHighlights(
  primary: ChordHighlight[],
  secondary: ChordHighlight[],
): ChordHighlight[] {
  const merged = [...primary];

  for (const item of secondary) {
    const overlaps = merged.some((existing) => {
      const xOverlap = Math.max(
        0,
        Math.min(
          existing.bbox.left + existing.bbox.width,
          item.bbox.left + item.bbox.width,
        ) - Math.max(existing.bbox.left, item.bbox.left),
      );
      const yOverlap = Math.max(
        0,
        Math.min(
          existing.bbox.top + existing.bbox.height,
          item.bbox.top + item.bbox.height,
        ) - Math.max(existing.bbox.top, item.bbox.top),
      );
      return xOverlap * yOverlap > 0;
    });
    if (!overlaps) merged.push(item);
  }

  return merged.sort(
    (a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left,
  );
}

export interface SheetAnalysisResult {
  provider: string;
  engine: string;
  imageWidth: number;
  imageHeight: number;
  words: OcrWord[];
  chordWords: OcrWord[];
  highlights: ChordHighlight[];
  chords: DetectedChord[];
  wordCount: number;
  rawText: string;
}

async function recognizeBestEngine(
  provider: ReturnType<typeof createOcrProvider>,
  buffer: Buffer,
  mimeType: string,
): Promise<{ result: Awaited<ReturnType<typeof provider.recognize>>; engine: string }> {
  const engines = ["2", "1"] as const;
  let best: Awaited<ReturnType<typeof provider.recognize>> | null = null;
  let bestEngine = "2";
  let bestScore = -1;

  for (const engine of engines) {
    try {
      const result = await provider.recognize(buffer, mimeType, engine);
      const chordWords = selectChordOcrWords(result.words);
      const score = chordWords.length * 10 + result.words.length;
      if (score > bestScore) {
        best = result;
        bestEngine = engine;
        bestScore = score;
      }
      if (chordWords.length >= 2) break;
    } catch {
      /* try next engine */
    }
  }

  if (!best) {
    throw new Error("OCR.space에서 텍스트를 읽지 못했습니다.");
  }

  return { result: best, engine: bestEngine };
}

export interface AnalyzeSheetOptions {
  semitones?: number;
  preferFlats?: boolean;
}

/** Full server-side pipeline: preprocess → OCR.space → chord extraction. */
export async function analyzeLeadSheetImage(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options: AnalyzeSheetOptions = {},
): Promise<SheetAnalysisResult> {
  const preprocessed = await preprocessForOcr(imageBuffer);
  const provider = createOcrProvider("ocr-space", apiKey);
  const { result: ocrResult, engine } = await recognizeBestEngine(
    provider,
    preprocessed.buffer,
    preprocessed.mimeType,
  );

  const words = scaleOcrWordsToOriginal(
    ocrResult.words,
    preprocessed,
    ocrResult.imageWidth,
    ocrResult.imageHeight,
  );

  const chordWords = selectChordOcrWords(words);
  const wordHighlights = extractChordHighlights(chordWords);
  const chords = extractChordsFromOcr(chordWords, preprocessed.originalHeight, {
    semitones: options.semitones ?? 0,
    preferFlats: options.preferFlats ?? false,
  });

  const highlights = mergeHighlights(
    wordHighlights,
    chords.map((chord) => ({
      text: chord.original,
      normalized: chord.original,
      bbox: chord.bbox,
      confidence: chord.confidence,
      isParsedChord: true,
      parsed: chord.original,
    })),
  );

  return {
    provider: ocrResult.provider,
    engine,
    imageWidth: preprocessed.originalWidth,
    imageHeight: preprocessed.originalHeight,
    words,
    chordWords,
    highlights,
    chords,
    wordCount: words.length,
    rawText: ocrResult.rawText,
  };
}
