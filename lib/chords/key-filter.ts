import type { OcrWord } from "../ocr/types";
import type { ChordHighlight } from "./highlights";
import { normalizeOcrText } from "./parser";
import { transposeChord } from "./transpose";
import type { DetectedChord } from "./types";
import type { KeyRoot } from "./types";
import {
  createKeyAnalysisContext,
  isTokenCompatibleWithKey,
  resolveChordForKey,
  type KeyContext,
  type KeyMode,
} from "./key-theory";

export interface KeyFilterStats {
  key: KeyRoot;
  mode: KeyMode;
  vocabularySize: number;
  rejectedTokens: number;
  correctedChords: number;
}

export interface KeyFilterContext {
  ctx: KeyContext;
  vocabulary: Set<string>;
}

export function createKeyFilter(fromKey: KeyRoot, mode: KeyMode = "major"): KeyFilterContext {
  const { ctx, vocabulary } = createKeyAnalysisContext(fromKey, mode);
  return { ctx, vocabulary };
}

export function filterOcrWordsByKey(
  words: OcrWord[],
  filter: KeyFilterContext,
): { words: OcrWord[]; stats: KeyFilterStats } {
  let rejectedTokens = 0;
  const kept: OcrWord[] = [];

  for (const word of words) {
    if (isTokenCompatibleWithKey(word.text, filter.ctx, filter.vocabulary)) {
      kept.push(word);
    } else {
      rejectedTokens += 1;
    }
  }

  return {
    words: kept,
    stats: {
      key: filter.ctx.key,
      mode: filter.ctx.mode,
      vocabularySize: filter.vocabulary.size,
      rejectedTokens,
      correctedChords: 0,
    },
  };
}

export function applyKeyFilterToChords(
  chords: DetectedChord[],
  filter: KeyFilterContext,
  options: { semitones?: number; preferFlats?: boolean } = {},
): { chords: DetectedChord[]; stats: KeyFilterStats } {
  const { semitones = 0, preferFlats = false } = options;
  let correctedChords = 0;
  let rejectedTokens = 0;
  const kept: DetectedChord[] = [];

  for (const chord of chords) {
    const resolved = resolveChordForKey(
      chord.original,
      filter.ctx,
      filter.vocabulary,
    );

    if (!resolved.accepted || !resolved.chord) {
      rejectedTokens += 1;
      continue;
    }

    if (resolved.corrected) correctedChords += 1;

    const original = resolved.chord;
    kept.push({
      ...chord,
      original,
      transposed: transposeChord(original, semitones, preferFlats),
      confidence: resolved.corrected
        ? Math.min(chord.confidence, 0.85)
        : chord.confidence,
    });
  }

  return {
    chords: kept,
    stats: {
      key: filter.ctx.key,
      mode: filter.ctx.mode,
      vocabularySize: filter.vocabulary.size,
      rejectedTokens,
      correctedChords,
    },
  };
}

export function applyKeyFilterToHighlights(
  highlights: ChordHighlight[],
  filter: KeyFilterContext,
): ChordHighlight[] {
  const kept: ChordHighlight[] = [];

  for (const item of highlights) {
    const token = item.normalized || normalizeOcrText(item.text);
    if (!token) continue;

    if (/^[A-G][#b]?$/i.test(token)) {
      if (isTokenCompatibleWithKey(token, filter.ctx, filter.vocabulary)) {
        kept.push(item);
      }
      continue;
    }

    const resolved = resolveChordForKey(token, filter.ctx, filter.vocabulary);
    if (!resolved.accepted || !resolved.chord) continue;

    kept.push({
      ...item,
      normalized: resolved.chord,
      parsed: resolved.chord,
      isParsedChord: true,
    });
  }

  return kept;
}
