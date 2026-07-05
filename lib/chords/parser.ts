/** Matches chord symbols like C, F#m, B/D#, Emaj9, Adim, Baug7, F#sus4, N.C. */
export const CHORD_PATTERN =
  /^([A-G])([#b]?)((?:maj|min|m|M|dim|aug|sus|add|no|N\.C\.|°|\+|Δ)?[\d]*(?:sus[24])?(?:maj\d*)?(?:min\d*)?(?:dim\d*)?(?:aug\d*)?(?:add\d*)?(?:M\d*)?(?:\d+)*)(?:\/([A-G])([#b]?))?$/i;

const BLACKLIST = new Set([
  "a",
  "an",
  "and",
  "bridge",
  "chorus",
  "go",
  "i",
  "intro",
  "it",
  "little",
  "loud",
  "my",
  "of",
  "or",
  "outro",
  "pre",
  "sing",
  "the",
  "to",
  "verse",
  "you",
  "at",
  "in",
  "on",
  "is",
  "be",
  "we",
  "he",
  "she",
  "me",
  "so",
  "do",
  "no",
  "up",
  "if",
]);

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[Oo]/g, (match, offset, str) =>
      /\d/.test(str.slice(offset + 1, offset + 2)) ? "0" : match,
    )
    .replace(/[|]/g, "/")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/[`'""]/g, "")
    // Superscript # misread as H (e.g. FHm7 → F#m7)
    .replace(/^([A-G])H(?=m|sus|maj|min|dim|aug|\d|\/)/i, "$1#")
    // Missing sharp: F7m → F#m7 (common OCR on bold labels)
    .replace(/^([A-G])7m(\d*)$/i, "$1#m7$2");
}

export function isLikelyChord(text: string): boolean {
  const normalized = normalizeOcrText(text);
  if (!normalized || normalized.length > 16) return false;

  const lower = normalized.toLowerCase();
  if (BLACKLIST.has(lower)) return false;

  if (/^(bridge|chorus|verse|intro|outro)\s?\d*$/i.test(normalized)) {
    return false;
  }

  if (/^n\.c\.?$/i.test(normalized)) return true;

  return CHORD_PATTERN.test(normalized);
}

export function parseChordSymbol(text: string): string | null {
  const normalized = normalizeOcrText(text);
  if (!isLikelyChord(normalized)) return null;

  if (/^n\.c\.?$/i.test(normalized)) return "N.C.";

  const match = normalized.match(CHORD_PATTERN);
  if (!match) return null;

  const root = match[1].toUpperCase() + (match[2] ?? "");
  const quality = match[3] ?? "";
  const bassRoot = match[4]?.toUpperCase();
  const bassAcc = match[5] ?? "";

  let result = root + quality;
  if (bassRoot) {
    result += `/${bassRoot}${bassAcc}`;
  }

  return result;
}
