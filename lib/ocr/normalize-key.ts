/** Trim whitespace and strip accidental quotes from copied API keys. */
export function normalizeOcrApiKey(key: string): string {
  return key.trim().replace(/^["']+|["']+$/g, "");
}
