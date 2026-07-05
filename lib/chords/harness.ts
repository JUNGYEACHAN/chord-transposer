import type { OcrWord } from "../ocr/types";
import { extractVerticalStackChords } from "./cluster";
import type { BoundingBox, DetectedChord } from "./types";
import {
  isLikelyChord,
  normalizeOcrText,
  parseChordSymbol,
} from "./parser";
import { transposeChord } from "./transpose";

const SECTION_PATTERN = /^(bridge|chorus|verse|intro|outro|pre-chorus|tag)\s?\d*$/i;

/** Tokens that can continue a split OCR chord, e.g. F# + sus4, B + /D# */
const CHORD_FRAGMENT =
  /^#|b$|^\/[A-G][#b]?$|^(m|maj|min|dim|aug|sus\d*|add\d*|M\d*|\d+)$/i;

interface LineGroup {
  words: OcrWord[];
  avgTop: number;
}

function groupWordsIntoLines(words: OcrWord[]): LineGroup[] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineGroup[] = [];

  for (const word of sorted) {
    const last = lines[lines.length - 1];
    // Wider threshold catches superscript # on the same logical line as the root.
    const threshold = Math.max(word.height * 1.25, 14);

    if (last && Math.abs(word.top - last.avgTop) <= threshold) {
      last.words.push(word);
      last.avgTop =
        last.words.reduce((sum, w) => sum + w.top, 0) / last.words.length;
    } else {
      lines.push({ words: [word], avgTop: word.top });
    }
  }

  return lines;
}

function isChordFragment(text: string): boolean {
  return CHORD_FRAGMENT.test(text);
}

function shouldMergeChordTokens(
  current: string,
  next: string,
  gap: number,
  height: number,
): boolean {
  const maxGap = Math.max(height * 2.2, 22);
  if (gap > maxGap) return false;

  const combined = current + next;
  if (isLikelyChord(combined)) return true;
  if (isChordFragment(next)) return true;
  if (/^[A-G]$/.test(current) && (next === "#" || next === "b")) return true;
  if (/^[A-G][#b]?$/.test(current) && isChordFragment(next)) return true;

  return false;
}

function mergeLineToCandidates(
  line: OcrWord[],
): Array<{ text: string; bbox: BoundingBox; confidence: number }> {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const tokens: Array<{ text: string; bbox: BoundingBox; confidence: number }> =
    [];

  for (const word of sorted) {
    const text = normalizeOcrText(word.text);
    if (!text || SECTION_PATTERN.test(text)) continue;
    if (/[\u3131-\uD79D]/.test(text)) continue;

    tokens.push({
      text,
      bbox: {
        left: word.left,
        top: word.top,
        width: word.width,
        height: word.height,
      },
      confidence: word.confidence,
    });
  }

  const merged: typeof tokens = [];
  for (let i = 0; i < tokens.length; i++) {
    let text = tokens[i].text;
    let bbox = { ...tokens[i].bbox };
    let confidence = tokens[i].confidence;

    while (i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const gap = next.bbox.left - (bbox.left + bbox.width);

      if (!shouldMergeChordTokens(text, next.text, gap, bbox.height)) {
        break;
      }

      bbox = {
        left: bbox.left,
        top: Math.min(bbox.top, next.bbox.top),
        width: next.bbox.left + next.bbox.width - bbox.left,
        height: Math.max(bbox.height, next.bbox.height),
      };
      text += next.text;
      confidence = Math.min(confidence, next.confidence);
      i++;
    }

    merged.push({ text, bbox, confidence });
  }

  return merged;
}

function extractHorizontalChords(
  words: OcrWord[],
): Array<{ text: string; bbox: BoundingBox; confidence: number }> {
  const lines = groupWordsIntoLines(words);
  const detected: Array<{ text: string; bbox: BoundingBox; confidence: number }> =
    [];

  for (const line of lines) {
    for (const candidate of mergeLineToCandidates(line.words)) {
      const parsed = parseChordSymbol(candidate.text);
      if (!parsed) continue;
      detected.push({ text: parsed, bbox: candidate.bbox, confidence: candidate.confidence });
    }
  }

  return detected;
}

export interface HarnessOptions {
  semitones?: number;
  preferFlats?: boolean;
}

/** Scan full page horizontally and vertically for chord symbols. */
export function extractChordsFromOcr(
  words: OcrWord[],
  _imageHeight: number,
  options: HarnessOptions = {},
): DetectedChord[] {
  const { semitones = 0, preferFlats = false } = options;

  const horizontal = extractHorizontalChords(words);
  const vertical = extractVerticalStackChords(words);

  const candidates = [...horizontal, ...vertical];
  const detected: DetectedChord[] = [];

  for (const candidate of candidates) {
    const parsed = parseChordSymbol(candidate.text);
    if (!parsed) continue;

    detected.push({
      original: parsed,
      transposed: transposeChord(parsed, semitones, preferFlats),
      bbox: candidate.bbox,
      confidence: candidate.confidence,
    });
  }

  return dedupeOverlappingChords(detected);
}

function overlapRatio(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  const overlapArea = xOverlap * yOverlap;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? overlapArea / minArea : 0;
}

function dedupeOverlappingChords(chords: DetectedChord[]): DetectedChord[] {
  const kept: DetectedChord[] = [];

  for (const chord of chords) {
    const duplicate = kept.find((k) => overlapRatio(k.bbox, chord.bbox) > 0.45);
    if (!duplicate) {
      kept.push(chord);
      continue;
    }
    if (chord.original.length > duplicate.original.length) {
      kept[kept.indexOf(duplicate)] = chord;
    }
  }

  return kept.sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);
}
