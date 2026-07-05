import type { OcrWord } from "../ocr/types";
import { isLikelyChord, normalizeOcrText, parseChordSymbol } from "./parser";
import type { BoundingBox } from "./types";

export interface ChordHighlight {
  text: string;
  normalized: string;
  bbox: BoundingBox;
  confidence: number;
  isParsedChord: boolean;
  parsed: string | null;
}

const SECTION_PATTERN = /^(bridge|chorus|verse|intro|outro|pre-chorus|tag)\s?\d*$/i;

const CHORD_FRAGMENT =
  /^#|b$|^\/[A-G][#b]?$|^(m|maj|min|dim|aug|sus\d*|add\d*|M\d*|\d+)$/i;

export function isChordLikeToken(text: string): boolean {
  const normalized = normalizeOcrText(text);
  if (!normalized || normalized.length > 14) return false;
  if (/[\u3131-\uD79D]/.test(normalized)) return false;
  if (SECTION_PATTERN.test(normalized)) return false;

  if (isLikelyChord(normalized)) return true;
  if (/^[A-G]$/i.test(normalized)) return true;
  if (normalized === "#" || normalized === "b") return true;
  if (CHORD_FRAGMENT.test(normalized)) return true;
  if (/^sus\d*$|^maj\d*$|^min\d*$|^m\d*$|^dim\d*$|^aug\d*$/i.test(normalized)) {
    return true;
  }

  return false;
}

/** Mark OCR tokens that look like chord symbols for blue overlay display. */
export function extractChordHighlights(words: OcrWord[]): ChordHighlight[] {
  const highlights: ChordHighlight[] = [];

  for (const word of words) {
    const normalized = normalizeOcrText(word.text);
    if (!isChordLikeToken(normalized)) continue;

    const parsed = parseChordSymbol(normalized);

    highlights.push({
      text: word.text,
      normalized,
      bbox: {
        left: word.left,
        top: word.top,
        width: word.width,
        height: word.height,
      },
      confidence: word.confidence,
      isParsedChord: parsed !== null,
      parsed,
    });
  }

  return highlights.sort(
    (a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left,
  );
}
