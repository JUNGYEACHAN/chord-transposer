import type { DetectedChord } from "@/lib/chords/types";
import type { OcrWord } from "@/lib/ocr/types";
import { withDb } from "./client";

export interface CorrectionRecordInput {
  imageHash: string;
  fileName?: string;
  fromKey: string;
  toKey: string;
  semitones: number;
  ocrProvider?: string;
  wordCount?: number;
  ocrWords: OcrWord[];
  autoChords: DetectedChord[];
  correctedChords: DetectedChord[];
  notes?: string;
}

export async function saveCorrectionRecord(
  input: CorrectionRecordInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();

  await withDb(async (db) => {
    await db.execute({
      sql: `INSERT INTO correction_records (
        id, image_hash, file_name, from_key, to_key, semitones,
        ocr_provider, word_count, ocr_words_json, auto_chords_json,
        corrected_chords_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.imageHash,
        input.fileName ?? null,
        input.fromKey,
        input.toKey,
        input.semitones,
        input.ocrProvider ?? null,
        input.wordCount ?? null,
        JSON.stringify(input.ocrWords),
        JSON.stringify(input.autoChords),
        JSON.stringify(input.correctedChords),
        input.notes ?? null,
      ],
    });
  });

  return { id };
}
