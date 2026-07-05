import type { OcrWord } from "./types";

function wordCenter(word: OcrWord): { x: number; y: number } {
  return {
    x: word.left + word.width / 2,
    y: word.top + word.height / 2,
  };
}

function wordsSimilar(a: OcrWord, b: OcrWord): boolean {
  const ca = wordCenter(a);
  const cb = wordCenter(b);
  const threshold = Math.max(a.height, b.height, 12) * 1.2;
  return Math.abs(ca.x - cb.x) <= threshold && Math.abs(ca.y - cb.y) <= threshold;
}

/** Drop duplicate tokens from overlapping OCR tiles or multi-engine passes. */
export function dedupeOcrWords(words: OcrWord[]): OcrWord[] {
  const kept: OcrWord[] = [];

  for (const word of words) {
    const duplicate = kept.find((existing) => wordsSimilar(existing, word));
    if (!duplicate) {
      kept.push(word);
      continue;
    }

    const prefer =
      word.text.length > duplicate.text.length ||
      (word.text.length === duplicate.text.length &&
        word.confidence > duplicate.confidence)
        ? word
        : duplicate;
    kept[kept.indexOf(duplicate)] = prefer;
  }

  return kept.sort((a, b) => a.top - b.top || a.left - b.left);
}
