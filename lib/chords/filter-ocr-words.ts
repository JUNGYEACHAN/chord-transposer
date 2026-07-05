import type { OcrWord } from "../ocr/types";
import { isChordLikeToken } from "./highlights";
import { normalizeOcrText } from "./parser";
import { dedupeOcrWords } from "../ocr/dedupe-words";

interface OcrLine {
  words: OcrWord[];
  avgTop: number;
}

const LYRIC_WORD =
  /^(sing|little|louder|the|and|with|your|my|we|you|at|in|on|a|to|of|it|is|be|he|she|me|so|do|no|up|if)$/i;

const SECTION_LABEL =
  /^(bridge|chorus|verse|intro|outro|pre-chorus|tag)\d*$/i;

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

function isSectionLabelToken(text: string): boolean {
  return SECTION_LABEL.test(normalizeOcrText(text));
}

function isPureLyricLine(line: OcrLine): boolean {
  const joined = line.words.map((word) => word.text).join(" ");
  if (/[\u3131-\uD79D]/.test(joined)) return true;

  const normalized = line.words
    .map((word) => normalizeOcrText(word.text))
    .filter(Boolean);

  if (normalized.length < 4) return false;

  const chordLike = normalized.filter((token) => isChordLikeToken(token)).length;
  if (chordLike > 0) return false;

  const lyricLike = normalized.filter(
    (token) => LYRIC_WORD.test(token) || (token.length > 3 && !isChordLikeToken(token)),
  ).length;

  return lyricLike >= 3;
}

function isChordToken(word: OcrWord): boolean {
  const normalized = normalizeOcrText(word.text);
  if (!normalized || isSectionLabelToken(normalized)) return false;
  return isChordLikeToken(normalized);
}

/**
 * Keep OCR tokens likely to belong to chord rows.
 * Key filtering is applied later on merged chords — not here — so fragments
 * like "F" + "#" + "sus4" survive long enough to assemble F#sus4.
 */
export function selectChordOcrWords(words: OcrWord[]): OcrWord[] {
  const lines = groupIntoLines(words);
  const selected: OcrWord[] = [];

  for (const line of lines) {
    const chordWords = line.words.filter(isChordToken);
    if (chordWords.length === 0) continue;
    if (isPureLyricLine(line)) continue;

    selected.push(...chordWords);
  }

  const globalCandidates = words.filter(isChordToken);
  const merged = dedupeOcrWords([...selected, ...globalCandidates]);

  if (merged.length > 0) return merged;

  return globalCandidates;
}
