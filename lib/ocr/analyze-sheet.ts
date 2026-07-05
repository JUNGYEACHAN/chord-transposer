import { selectChordOcrWords } from "../chords/filter-ocr-words";
import { extractChordsFromOcr } from "../chords/harness";
import {
  applyKeyFilterToChords,
  applyKeyFilterToHighlights,
  createKeyFilter,
  type KeyFilterStats,
} from "../chords/key-filter";
import {
  extractChordHighlights,
  type ChordHighlight,
} from "../chords/highlights";
import type { DetectedChord, KeyRoot } from "../chords/types";
import {
  preprocessForOcr,
  scaleOcrWordsToOriginal,
} from "../images/preprocess-for-ocr";
import { createOcrProvider } from "./index";
import { recognizeTiledImage } from "./tiled-recognize";
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
  tileCount: number;
  imageWidth: number;
  imageHeight: number;
  words: OcrWord[];
  chordWords: OcrWord[];
  highlights: ChordHighlight[];
  chords: DetectedChord[];
  wordCount: number;
  rawText: string;
  keyFilter?: KeyFilterStats;
}

async function recognizeWithBestEngine(
  provider: ReturnType<typeof createOcrProvider>,
  preprocessed: Awaited<ReturnType<typeof preprocessForOcr>>,
  fromKey?: KeyRoot,
): Promise<{
  words: OcrWord[];
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  engine: string;
  tileCount: number;
}> {
  const engines = ["2", "1"] as const;
  let best: Awaited<ReturnType<typeof recognizeTiledImage>> | null = null;
  let bestEngine = "2";
  let bestScore = -1;

  for (const engine of engines) {
    try {
      const result = await recognizeTiledImage(provider, preprocessed, engine);
      const chordWords = selectChordOcrWords(
        scaleOcrWordsToOriginal(
          result.words,
          preprocessed,
          result.imageWidth,
          result.imageHeight,
        ),
        fromKey,
      );
      const score = chordWords.length * 10 + result.words.length;
      if (score > bestScore) {
        best = result;
        bestEngine = engine;
        bestScore = score;
      }
      if (chordWords.length >= 4) break;
    } catch {
      /* try next engine */
    }
  }

  if (!best) {
    throw new Error("OCR.space에서 텍스트를 읽지 못했습니다.");
  }

  return {
    words: best.words,
    imageWidth: best.imageWidth,
    imageHeight: best.imageHeight,
    rawText: best.rawText,
    engine: bestEngine,
    tileCount: best.tileCount,
  };
}

export interface AnalyzeSheetOptions {
  semitones?: number;
  preferFlats?: boolean;
  fromKey?: KeyRoot;
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
  const ocrPass = await recognizeWithBestEngine(
    provider,
    preprocessed,
    options.fromKey,
  );

  const words = scaleOcrWordsToOriginal(
    ocrPass.words,
    preprocessed,
    ocrPass.imageWidth,
    ocrPass.imageHeight,
  );

  const chordWords = selectChordOcrWords(words, options.fromKey);
  const keyFilter = options.fromKey
    ? createKeyFilter(options.fromKey, "major")
    : null;

  const rawHighlights = extractChordHighlights(chordWords);
  const chordsBeforeKey = extractChordsFromOcr(
    chordWords,
    preprocessed.originalHeight,
    {
      semitones: options.semitones ?? 0,
      preferFlats: options.preferFlats ?? false,
    },
  );

  let chords = chordsBeforeKey;
  let wordHighlights = rawHighlights;
  let keyFilterStats: KeyFilterStats | undefined;

  if (keyFilter) {
    wordHighlights = applyKeyFilterToHighlights(rawHighlights, keyFilter);
    const filtered = applyKeyFilterToChords(chordsBeforeKey, keyFilter, {
      semitones: options.semitones ?? 0,
      preferFlats: options.preferFlats ?? false,
    });
    chords = filtered.chords;
    keyFilterStats = {
      ...filtered.stats,
      rejectedTokens:
        filtered.stats.rejectedTokens +
        Math.max(0, rawHighlights.length - wordHighlights.length),
    };
  }

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
    provider: "ocr-space",
    engine: ocrPass.engine,
    tileCount: ocrPass.tileCount,
    imageWidth: preprocessed.originalWidth,
    imageHeight: preprocessed.originalHeight,
    words,
    chordWords,
    highlights,
    chords,
    wordCount: words.length,
    rawText: ocrPass.rawText,
    keyFilter: keyFilterStats,
  };
}
