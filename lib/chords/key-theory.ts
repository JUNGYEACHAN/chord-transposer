import { parseChordSymbol, normalizeOcrText } from "./parser";
import type { KeyRoot } from "./types";

/** Pitch class 0–11 (C=0). */
export const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export type KeyMode = "major" | "harmonic-minor";

export type QualityFamily =
  | "major"
  | "minor"
  | "diminished"
  | "dominant"
  | "suspended";

export interface ChordParts {
  root: string;
  rootPc: number;
  quality: string;
  bass?: string;
  bassPc?: number;
  normalized: string;
}

export interface KeyContext {
  key: KeyRoot;
  mode: KeyMode;
  tonicPc: number;
  scalePcs: number[];
  spellingByPc: Map<number, string>;
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const HARMONIC_MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 11] as const;

const MAJOR_DEGREE_FAMILIES: QualityFamily[][] = [
  ["major", "suspended"],
  ["minor"],
  ["minor"],
  ["major", "suspended"],
  ["major", "dominant", "suspended"],
  ["minor"],
  ["diminished"],
];

const HARMONIC_MINOR_DEGREE_FAMILIES: QualityFamily[][] = [
  ["minor"],
  ["diminished"],
  ["major"],
  ["minor"],
  ["major", "dominant"],
  ["major"],
  ["diminished", "dominant"],
];

const SHARP_KEYS = new Set<KeyRoot>([
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "D#",
  "G#",
  "A#",
]);

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export function noteNameToPc(note: string): number | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  const normalized =
    trimmed.charAt(0).toUpperCase() +
    trimmed.slice(1).replace("♯", "#").replace("♭", "b");
  return NOTE_TO_PC[normalized] ?? null;
}

export function pcToNoteName(pc: number, preferSharps: boolean): string {
  const index = ((pc % 12) + 12) % 12;
  return preferSharps ? SHARP_NAMES[index] : FLAT_NAMES[index];
}

export function getKeyTonicPc(key: KeyRoot): number {
  const pc = NOTE_TO_PC[key];
  if (pc === undefined) throw new Error(`Unknown key: ${key}`);
  return pc;
}

export function keyPrefersSharps(key: KeyRoot): boolean {
  return SHARP_KEYS.has(key);
}

export function buildKeyContext(
  key: KeyRoot,
  mode: KeyMode = "major",
): KeyContext {
  const tonicPc = getKeyTonicPc(key);
  const intervals =
    mode === "major" ? MAJOR_INTERVALS : HARMONIC_MINOR_INTERVALS;
  const scalePcs = intervals.map((interval) => (tonicPc + interval) % 12);
  const preferSharps = keyPrefersSharps(key);
  const spellingByPc = new Map<number, string>();

  for (const pc of scalePcs) {
    spellingByPc.set(pc, pcToNoteName(pc, preferSharps));
  }

  return { key, mode, tonicPc, scalePcs, spellingByPc };
}

export function parseChordParts(text: string): ChordParts | null {
  const normalized = parseChordSymbol(text);
  if (!normalized) return null;
  if (/^n\.c\.?$/i.test(normalized)) {
    return {
      root: "N.C.",
      rootPc: -1,
      quality: "",
      normalized: "N.C.",
    };
  }

  const match = normalized.match(/^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/i);
  if (!match) return null;

  const root = match[1].toUpperCase() + (match[2] ?? "");
  const rootPc = noteNameToPc(root);
  if (rootPc === null) return null;

  const quality = match[3] ?? "";
  let bass: string | undefined;
  let bassPc: number | undefined;

  if (match[4]) {
    bass = match[4].toUpperCase() + (match[5] ?? "");
    const pc = noteNameToPc(bass);
    if (pc === null) return null;
    bassPc = pc;
  }

  return { root, rootPc, quality, bass, bassPc, normalized };
}

export function classifyQualityFamily(quality: string): QualityFamily {
  const q = quality.trim();

  if (!q) return "major";

  if (/^sus/i.test(q) || /^[24]$/.test(q)) return "suspended";

  if (/dim|°|o(?=\d)/i.test(q) || /m7b5|m7\(b5\)|Ø/i.test(q)) {
    return "diminished";
  }

  if (/^m(?!aj)|^min/i.test(q) && !/^maj/i.test(q)) return "minor";

  if (/^maj/i.test(q) || /^M(?!in)/.test(q) || /Δ/.test(q)) return "major";

  if (/^6$|^add/i.test(q)) return "major";

  if (/^7$|^9$|^11$|^13$|^7\(/i.test(q) || /7sus|9sus/i.test(q)) {
    return "dominant";
  }

  if (/7/.test(q)) {
    if (/maj.*7|Δ7|M7/i.test(q)) return "major";
    if (/m7(?!aj)/i.test(q)) return "minor";
    return "dominant";
  }

  if (/^\+|aug/i.test(q)) return "major";

  return "major";
}

function getScaleDegree(rootPc: number, ctx: KeyContext): number | null {
  const idx = ctx.scalePcs.indexOf(((rootPc % 12) + 12) % 12);
  return idx >= 0 ? idx : null;
}

function degreeFamilies(ctx: KeyContext, degree: number): QualityFamily[] {
  return ctx.mode === "major"
    ? MAJOR_DEGREE_FAMILIES[degree]
    : HARMONIC_MINOR_DEGREE_FAMILIES[degree];
}

export function isPitchClassInKey(pc: number, ctx: KeyContext): boolean {
  return ctx.scalePcs.includes(((pc % 12) + 12) % 12);
}

export function isChordInKey(chord: string, ctx: KeyContext): boolean {
  const parts = parseChordParts(chord);
  if (!parts) return false;
  if (parts.normalized === "N.C.") return true;

  const degree = getScaleDegree(parts.rootPc, ctx);
  if (degree === null) return false;

  const family = classifyQualityFamily(parts.quality);
  if (!degreeFamilies(ctx, degree).includes(family)) return false;

  if (parts.bassPc !== undefined && !isPitchClassInKey(parts.bassPc, ctx)) {
    return false;
  }

  return true;
}

export function canonicalizeRootForKey(root: string, ctx: KeyContext): string {
  const pc = noteNameToPc(root);
  if (pc === null) return root;
  return ctx.spellingByPc.get(pc) ?? root;
}

export function formatChordParts(parts: ChordParts, ctx: KeyContext): string {
  if (parts.normalized === "N.C.") return "N.C.";

  let result = canonicalizeRootForKey(parts.root, ctx) + parts.quality;
  if (parts.bass) {
    result += `/${canonicalizeRootForKey(parts.bass, ctx)}`;
  }
  return result;
}

const MAJOR_SUFFIXES = [
  "",
  "maj7",
  "maj9",
  "maj11",
  "6",
  "add9",
  "add2",
  "sus2",
  "sus4",
  "sus",
  "2",
  "4",
  "7",
  "9",
  "7sus4",
] as const;

const MINOR_SUFFIXES = ["m", "m7", "m9", "m11", "m6"] as const;
const DIM_SUFFIXES = ["dim", "dim7", "m7b5", "°"] as const;

function suffixesForDegree(ctx: KeyContext, degree: number): string[] {
  const families = degreeFamilies(ctx, degree);
  const suffixes = new Set<string>();

  for (const family of families) {
    switch (family) {
      case "major":
        for (const s of MAJOR_SUFFIXES) suffixes.add(s);
        break;
      case "minor":
        for (const s of MINOR_SUFFIXES) suffixes.add(s);
        break;
      case "diminished":
        for (const s of DIM_SUFFIXES) suffixes.add(s);
        break;
      case "dominant":
        suffixes.add("7");
        suffixes.add("9");
        suffixes.add("11");
        suffixes.add("13");
        suffixes.add("7sus4");
        break;
      case "suspended":
        suffixes.add("sus2");
        suffixes.add("sus4");
        suffixes.add("sus");
        suffixes.add("2");
        suffixes.add("4");
        break;
    }
  }

  return [...suffixes];
}

export function buildKeyChordVocabulary(ctx: KeyContext): Set<string> {
  const vocabulary = new Set<string>();
  vocabulary.add("N.C.");

  for (let degree = 0; degree < ctx.scalePcs.length; degree++) {
    const rootPc = ctx.scalePcs[degree];
    const rootName =
      ctx.spellingByPc.get(rootPc) ??
      pcToNoteName(rootPc, keyPrefersSharps(ctx.key));

    for (const suffix of suffixesForDegree(ctx, degree)) {
      const base = rootName + suffix;
      vocabulary.add(base);

      for (const bassPc of ctx.scalePcs) {
        const bassName =
          ctx.spellingByPc.get(bassPc) ??
          pcToNoteName(bassPc, keyPrefersSharps(ctx.key));
        vocabulary.add(`${base}/${bassName}`);
      }
    }
  }

  return vocabulary;
}

export function isTokenCompatibleWithKey(
  token: string,
  ctx: KeyContext,
  vocabulary: Set<string>,
): boolean {
  const normalized = normalizeOcrText(token);
  if (!normalized) return false;
  if (/^n\.c\.?$/i.test(normalized)) return true;

  if (vocabulary.has(normalized)) return true;

  const parts = parseChordParts(normalized);
  if (parts && isChordInKey(parts.normalized, ctx)) return true;

  if (/^[A-G][#b]?$/i.test(normalized)) {
    const pc = noteNameToPc(normalized);
    return pc !== null && isPitchClassInKey(pc, ctx);
  }

  if (/^#|^b$|^(m|maj|min|dim|aug|sus\d*|add\d*|\d+)$/i.test(normalized)) {
    return true;
  }

  if (/^\/[A-G][#b]?$/i.test(normalized)) {
    const bass = normalized.slice(1);
    const pc = noteNameToPc(bass);
    return pc !== null && isPitchClassInKey(pc, ctx);
  }

  return false;
}

export interface KeyResolveResult {
  accepted: boolean;
  chord: string | null;
  corrected: boolean;
  reason?: string;
}

export function resolveChordForKey(
  raw: string,
  ctx: KeyContext,
  vocabulary: Set<string>,
): KeyResolveResult {
  const normalized = normalizeOcrText(raw);
  if (!normalized) {
    return { accepted: false, chord: null, corrected: false, reason: "empty" };
  }

  if (/^n\.c\.?$/i.test(normalized)) {
    return { accepted: true, chord: "N.C.", corrected: false };
  }

  const parsed = parseChordParts(normalized);
  if (!parsed) {
    return { accepted: false, chord: null, corrected: false, reason: "parse" };
  }

  const canonical = formatChordParts(parsed, ctx);
  if (vocabulary.has(canonical) || isChordInKey(canonical, ctx)) {
    return {
      accepted: true,
      chord: canonical,
      corrected: canonical !== parsed.normalized,
    };
  }

  const corrected = tryCorrectChordToKey(parsed, ctx, vocabulary);
  if (corrected) {
    return { accepted: true, chord: corrected, corrected: true };
  }

  return {
    accepted: false,
    chord: null,
    corrected: false,
    reason: "not-in-key",
  };
}

function tryCorrectChordToKey(
  parts: ChordParts,
  ctx: KeyContext,
  vocabulary: Set<string>,
): string | null {
  const accepted: string[] = [];

  for (const delta of [1, -1]) {
    const newPc = (parts.rootPc + delta + 12) % 12;
    if (!isPitchClassInKey(newPc, ctx)) continue;
    const formatted = formatChordParts(
      {
        ...parts,
        rootPc: newPc,
        root: pcToNoteName(newPc, keyPrefersSharps(ctx.key)),
      },
      ctx,
    );
    if (vocabulary.has(formatted) || isChordInKey(formatted, ctx)) {
      accepted.push(formatted);
    }
  }

  if (parts.bassPc !== undefined) {
    for (const delta of [1, -1]) {
      const newBassPc = (parts.bassPc + delta + 12) % 12;
      if (!isPitchClassInKey(newBassPc, ctx)) continue;
      const formatted = formatChordParts(
        {
          ...parts,
          bassPc: newBassPc,
          bass: pcToNoteName(newBassPc, keyPrefersSharps(ctx.key)),
        },
        ctx,
      );
      if (vocabulary.has(formatted) || isChordInKey(formatted, ctx)) {
        accepted.push(formatted);
      }
    }
  }

  const unique = [...new Set(accepted)];
  if (unique.length === 1) return unique[0];

  if (unique.length > 1) {
    const preferSharps = keyPrefersSharps(ctx.key);
    const spelled = unique.filter((chord) => {
      const parts = parseChordParts(chord);
      if (!parts) return false;
      const expected = ctx.spellingByPc.get(parts.rootPc);
      return expected === parts.root;
    });
    if (spelled.length === 1) return spelled[0];

    const upliftPc = (parts.rootPc + 1) % 12;
    if (preferSharps && isPitchClassInKey(upliftPc, ctx)) {
      const uplift = formatChordParts(
        {
          ...parts,
          rootPc: upliftPc,
          root: pcToNoteName(upliftPc, true),
        },
        ctx,
      );
      if (unique.includes(uplift)) return uplift;
    }

    const downliftPc = (parts.rootPc + 11) % 12;
    if (!preferSharps && isPitchClassInKey(downliftPc, ctx)) {
      const downlift = formatChordParts(
        {
          ...parts,
          rootPc: downliftPc,
          root: pcToNoteName(downliftPc, false),
        },
        ctx,
      );
      if (unique.includes(downlift)) return downlift;
    }
  }

  return null;
}

export function createKeyAnalysisContext(
  key: KeyRoot,
  mode: KeyMode = "major",
): {
  ctx: KeyContext;
  vocabulary: Set<string>;
} {
  const ctx = buildKeyContext(key, mode);
  const vocabulary = buildKeyChordVocabulary(ctx);
  return { ctx, vocabulary };
}
