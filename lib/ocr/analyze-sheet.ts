import { selectChordOcrWords } from "../chords/filter-ocr-words";
import { highlightsFromChords } from "../chords/chord-highlights";
import { extractChordsFromOcr } from "../chords/harness";
import {
  applyKeyFilterToChords,
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
import { dedupeOcrWords } from "./dedupe-words";
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
): Promise<{
  words: OcrWord[];
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  engine: string;
  tileCount: number;
}> {
  const engines = ["2", "1"] as const;
  const passes: Array<{
    result: Awaited<ReturnType<typeof recognizeTiledImage>>;
    engine: string;
    score: number;
  }> = [];

  for (const engine of engines) {
    try {
      const result = await recognizeTiledImage(provider, preprocessed, engine);
      const scaled = scaleOcrWordsToOriginal(
        result.words,
        preprocessed,
        result.imageWidth,
        result.imageHeight,
      );
      const chordWords = selectChordOcrWords(scaled);
      const score = chordWords.length * 10 + result.words.length;
      passes.push({ result, engine, score });
    } catch {
      /* try next engine */
    }
  }

  if (passes.length === 0) {
    throw new Error("OCR.space에서 텍스트를 읽지 못했습니다.");
  }

  passes.sort((a, b) => b.score - a.score);
  const mergedWords = dedupeOcrWords(
    passes.flatMap((pass) => pass.result.words),
  );
  const best = passes[0];

  return {
    words: mergedWords.length > best.result.words.length ? mergedWords : best.result.words,
    imageWidth: best.result.imageWidth,
    imageHeight: best.result.imageHeight,
    rawText: passes.map((pass) => pass.result.rawText).join("\n"),
    engine: passes.length > 1 ? `${best.engine}+merge` : best.engine,
    tileCount: best.result.tileCount,
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
  const ocrPass = await recognizeWithBestEngine(provider, preprocessed);

  const words = scaleOcrWordsToOriginal(
    ocrPass.words,
    preprocessed,
    ocrPass.imageWidth,
    ocrPass.imageHeight,
  );

  const chordWords = selectChordOcrWords(words);
  const keyFilter = options.fromKey
    ? createKeyFilter(options.fromKey, "major")
    : null;

  const chordsBeforeKey = extractChordsFromOcr(
    chordWords,
    preprocessed.originalHeight,
    {
      semitones: options.semitones ?? 0,
      preferFlats: options.preferFlats ?? false,
    },
  );

  let chords = chordsBeforeKey;
  let keyFilterStats: KeyFilterStats | undefined;

  if (keyFilter) {
    const filtered = applyKeyFilterToChords(chordsBeforeKey, keyFilter, {
      semitones: options.semitones ?? 0,
      preferFlats: options.preferFlats ?? false,
    });
    chords = filtered.chords;
    keyFilterStats = filtered.stats;
  }

  const tokenHighlights = extractChordHighlights(chordWords);
  const highlights = mergeHighlights(
    highlightsFromChords(chords),
    tokenHighlights.filter((item) =>
      chords.some(
        (chord) =>
          item.parsed === chord.original ||
          item.normalized === chord.original,
      ),
    ),
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
