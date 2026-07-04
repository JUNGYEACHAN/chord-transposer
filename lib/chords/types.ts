export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetectedChord {
  original: string;
  transposed: string;
  bbox: BoundingBox;
  confidence: number;
}

export type KeyRoot =
  | "C"
  | "C#"
  | "Db"
  | "D"
  | "D#"
  | "Eb"
  | "E"
  | "F"
  | "F#"
  | "Gb"
  | "G"
  | "G#"
  | "Ab"
  | "A"
  | "A#"
  | "Bb"
  | "B";

export const KEY_OPTIONS: KeyRoot[] = [
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
];
