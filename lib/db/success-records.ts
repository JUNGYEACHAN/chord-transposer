import type { DetectedChord } from "@/lib/chords/types";
import type { OcrWord } from "@/lib/ocr/types";
import { withDb } from "./client";

export interface SuccessRecordInput {
  imageHash: string;
  fileName?: string;
  fromKey: string;
  toKey: string;
  semitones: number;
  ocrProvider?: string;
  ocrEngine?: string;
  tileCount?: number;
  wordCount?: number;
  chordCount: number;
  ocrWords: OcrWord[];
  chords: DetectedChord[];
}

export async function saveSuccessRecord(
  input: SuccessRecordInput,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();

  await withDb(async (db) => {
    await db.execute({
      sql: `INSERT INTO success_records (
        id, image_hash, file_name, from_key, to_key, semitones,
        ocr_provider, ocr_engine, tile_count, word_count, chord_count,
        ocr_words_json, chords_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.imageHash,
        input.fileName ?? null,
        input.fromKey,
        input.toKey,
        input.semitones,
        input.ocrProvider ?? null,
        input.ocrEngine ?? null,
        input.tileCount ?? 1,
        input.wordCount ?? null,
        input.chordCount,
        JSON.stringify(input.ocrWords),
        JSON.stringify(input.chords),
      ],
    });
  });

  return { id };
}

export async function countSuccessRecords(): Promise<number> {
  return withDb(async (db) => {
    const result = await db.execute(`SELECT COUNT(*) AS count FROM success_records`);
    return Number(result.rows[0]?.count ?? 0);
  });
}
