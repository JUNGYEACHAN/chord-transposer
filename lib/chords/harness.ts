import type { OcrWord } from "../ocr/types";
import type { BoundingBox, DetectedChord } from "./types";
import { isLikelyChord, normalizeOcrText, parseChordSymbol } from "./parser";
import { transposeChord } from "./transpose";

const SECTION_PATTERN = /^(bridge|chorus|verse|intro|outro)\s?\d*$/i;

interface LineGroup {
  words: OcrWord[];
  avgTop: number;
}

function groupWordsIntoLines(words: OcrWord[]): LineGroup[] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineGroup[] = [];

  for (const word of sorted) {
    const last = lines[lines.length - 1];
    const threshold = Math.max(word.height * 0.6, 8);

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

function mergeLineToCandidates(line: OcrWord[]): Array<{ text: string; bbox: BoundingBox; confidence: number }> {
  const sorted = [...line].sort((a, b) => a.left - b.left);
  const candidates: Array<{ text: string; bbox: BoundingBox; confidence: number }> = [];

  for (const word of sorted) {
    const text = normalizeOcrText(word.text);
    if (!text || SECTION_PATTERN.test(text)) continue;

    candidates.push({
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

  // Merge adjacent tokens on the same line (e.g. "F#" + "sus4")
  const merged: typeof candidates = [];
  for (let i = 0; i < candidates.length; i++) {
    let text = candidates[i].text;
    let bbox = { ...candidates[i].bbox };
    let confidence = candidates[i].confidence;

    while (i + 1 < candidates.length) {
      const next = candidates[i + 1];
      const gap = next.bbox.left - (bbox.left + bbox.width);
      const combined = text + next.text;

      if (gap <= Math.max(bbox.height, 12) && isLikelyChord(combined)) {
        bbox = {
          left: bbox.left,
          top: Math.min(bbox.top, next.bbox.top),
          width: next.bbox.left + next.bbox.width - bbox.left,
          height: Math.max(bbox.height, next.bbox.height),
        };
        text = combined;
        confidence = Math.min(confidence, next.confidence);
        i++;
      } else {
        break;
      }
    }

    merged.push({ text, bbox, confidence });
  }

  return merged;
}

export interface HarnessOptions {
  /** Fraction of image height treated as the chord zone (top portion). */
  chordZoneRatio?: number;
  semitones?: number;
  preferFlats?: boolean;
}

export function extractChordsFromOcr(
  words: OcrWord[],
  imageHeight: number,
  options: HarnessOptions = {},
): DetectedChord[] {
  const { chordZoneRatio = 0.42, semitones = 0, preferFlats = false } = options;
  const chordZoneMaxY = imageHeight * chordZoneRatio;
  const chordWords = words.filter((w) => w.top <= chordZoneMaxY);
  const lines = groupWordsIntoLines(chordWords);
  const detected: DetectedChord[] = [];

  for (const line of lines) {
    for (const candidate of mergeLineToCandidates(line.words)) {
      const parsed = parseChordSymbol(candidate.text);
      if (!parsed) continue;

      detected.push({
        original: parsed,
        transposed: transposeChord(parsed, semitones, preferFlats),
        bbox: candidate.bbox,
        confidence: candidate.confidence,
      });
    }
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
    const duplicate = kept.find((k) => overlapRatio(k.bbox, chord.bbox) > 0.5);
    if (!duplicate) {
      kept.push(chord);
      continue;
    }
    if (chord.original.length > duplicate.original.length) {
      const index = kept.indexOf(duplicate);
      kept[index] = chord;
    }
  }

  return kept;
}
