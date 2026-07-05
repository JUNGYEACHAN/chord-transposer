import type { OcrWord } from "./types";

function wordCenter(word: OcrWord): { x: number; y: number } {
  return {
    x: word.left + word.width / 2,
    y: word.top + word.height / 2,
  };
}

function wordsSimilar(a: OcrWord, b: OcrWord): boolean {
  if (a.text.toLowerCase() !== b.text.toLowerCase()) return false;
  const ca = wordCenter(a);
  const cb = wordCenter(b);
  const threshold = Math.max(a.height, b.height, 12) * 1.2;
  return Math.abs(ca.x - cb.x) <= threshold && Math.abs(ca.y - cb.y) <= threshold;
}

/** Drop duplicate tokens from overlapping OCR tiles. */
export function dedupeOcrWords(words: OcrWord[]): OcrWord[] {
  const kept: OcrWord[] = [];

  for (const word of words) {
    const duplicate = kept.find((existing) => wordsSimilar(existing, word));
    if (!duplicate) {
      kept.push(word);
      continue;
    }
    if (word.confidence > duplicate.confidence) {
      kept[kept.indexOf(duplicate)] = word;
    }
  }

  return kept.sort((a, b) => a.top - b.top || a.left - b.left);
}
