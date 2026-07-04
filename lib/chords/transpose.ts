import type { KeyRoot } from "./types";

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

const NOTE_TO_SEMITONE: Record<string, number> = {
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

const KEY_TO_SEMITONE: Record<KeyRoot, number> = {
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

function noteToSemitone(note: string): number | null {
  const normalized =
    note.charAt(0).toUpperCase() + note.slice(1).replace("♯", "#").replace("♭", "b");
  return NOTE_TO_SEMITONE[normalized] ?? null;
}

function semitoneToNote(semitone: number, preferFlats: boolean): string {
  const index = ((semitone % 12) + 12) % 12;
  return preferFlats ? FLAT_NAMES[index] : SHARP_NAMES[index];
}

function transposeNote(note: string, semitones: number, preferFlats: boolean): string {
  const base = noteToSemitone(note);
  if (base === null) return note;
  return semitoneToNote(base + semitones, preferFlats);
}

export function semitonesBetweenKeys(fromKey: KeyRoot, toKey: KeyRoot): number {
  const from = KEY_TO_SEMITONE[fromKey];
  const to = KEY_TO_SEMITONE[toKey];
  return ((to - from) % 12 + 12) % 12;
}

export function transposeChord(
  chord: string,
  semitones: number,
  preferFlats = false,
): string {
  if (semitones === 0) return chord;
  if (/^n\.c\.?$/i.test(chord)) return "N.C.";

  const match = chord.match(/^([A-G])([#b]?)(.*)$/i);
  if (!match) return chord;

  const root = match[1].toUpperCase() + (match[2] ?? "");
  const rest = match[3] ?? "";

  const slashIndex = rest.indexOf("/");
  let quality = rest;
  let bassPart = "";

  if (slashIndex >= 0) {
    quality = rest.slice(0, slashIndex);
    bassPart = rest.slice(slashIndex + 1);
  }

  const transposedRoot = transposeNote(root, semitones, preferFlats);

  let result = transposedRoot + quality;
  if (bassPart) {
    const bassMatch = bassPart.match(/^([A-G])([#b]?)$/i);
    if (bassMatch) {
      const bassRoot = bassMatch[1].toUpperCase() + (bassMatch[2] ?? "");
      result += `/${transposeNote(bassRoot, semitones, preferFlats)}`;
    } else {
      result += `/${bassPart}`;
    }
  }

  return result;
}
