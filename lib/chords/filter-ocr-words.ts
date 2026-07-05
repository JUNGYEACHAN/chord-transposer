import type { OcrWord } from "../ocr/types";
import { isChordLikeToken } from "./highlights";
import { normalizeOcrText } from "./parser";

interface OcrLine {
  words: OcrWord[];
  avgTop: number;
}

const LYRIC_HINT =
  /\b(sing|little|louder|bridge|chorus|verse|intro|outro|the|and|with|your|my|we|you)\b/i;

function groupIntoLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: OcrLine[] = [];

  for (const word of sorted) {
    const last = lines[lines.length - 1];
    const threshold = Math.max(word.height * 1.35, 16);

    if (last && Math.abs(word.top - last.avgTop) <= threshold) {
      last.words.push(word);
      last.avgTop =
        last.words.reduce((sum, item) => sum + item.top, 0) / last.words.length;
    } else {
      lines.push({ words: [word], avgTop: word.top });
    }
  }

  return lines;
}

function isLyricLine(line: OcrLine): boolean {
  const joined = line.words.map((word) => word.text).join(" ");
  if (/[\u3131-\uD79D]/.test(joined)) return true;

  const normalized = line.words
    .map((word) => normalizeOcrText(word.text))
    .filter(Boolean);

  if (normalized.length >= 4 && LYRIC_HINT.test(joined)) return true;

  const nonChord = normalized.filter(
    (token) => !isChordLikeToken(token) && token.length > 2,
  );
  return normalized.length >= 5 && nonChord.length >= 3;
}

function isChordLine(line: OcrLine): boolean {
  if (isLyricLine(line)) return false;

  const normalized = line.words
    .map((word) => normalizeOcrText(word.text))
    .filter(Boolean);

  if (normalized.length === 0) return false;

  const chordLike = normalized.filter((token) => isChordLikeToken(token)).length;
  if (chordLike === 0) return false;

  return chordLike / normalized.length >= 0.34 || (normalized.length <= 2 && chordLike >= 1);
}

/** Keep OCR tokens likely to belong to chord rows (not lyrics or section labels). */
export function selectChordOcrWords(words: OcrWord[]): OcrWord[] {
  const lines = groupIntoLines(words);
  const chordLines = lines.filter(isChordLine);

  if (chordLines.length > 0) {
    return chordLines.flatMap((line) => line.words);
  }

  return words.filter((word) => isChordLikeToken(normalizeOcrText(word.text)));
}
