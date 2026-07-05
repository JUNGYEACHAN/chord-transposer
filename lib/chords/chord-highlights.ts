import type { DetectedChord } from "./types";
import type { ChordHighlight } from "./highlights";

/** Build preview highlights from merged chord bboxes (more reliable than raw OCR tokens). */
export function highlightsFromChords(chords: DetectedChord[]): ChordHighlight[] {
  return chords.map((chord) => ({
    text: chord.original,
    normalized: chord.original,
    bbox: chord.bbox,
    confidence: chord.confidence,
    isParsedChord: true,
    parsed: chord.original,
  }));
}
