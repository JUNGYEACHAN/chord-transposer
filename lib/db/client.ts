import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function getTursoConfig() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (!url) {
    throw new Error("TURSO_DATABASE_URL 환경 변수가 설정되지 않았습니다.");
  }

  return { url, authToken };
}

export function isTursoConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL?.trim());
}

export function getDb(): Client {
  if (!client) {
    const { url, authToken } = getTursoConfig();
    client = createClient({ url, authToken });
  }
  return client;
}

async function ensureSchema(): Promise<void> {
  const db = getDb();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS correction_records (
      id TEXT PRIMARY KEY,
      image_hash TEXT NOT NULL,
      file_name TEXT,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      semitones INTEGER NOT NULL,
      ocr_provider TEXT,
      word_count INTEGER,
      ocr_words_json TEXT NOT NULL,
      auto_chords_json TEXT NOT NULL,
      corrected_chords_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_correction_records_image_hash
      ON correction_records(image_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_correction_records_created_at
      ON correction_records(created_at)`,
  ]);
}

export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  if (!schemaReady) {
    schemaReady = ensureSchema();
  }
  await schemaReady;
  return fn(getDb());
}
