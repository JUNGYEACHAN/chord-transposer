import {
  buildKeyContext,
  createKeyAnalysisContext,
  isChordInKey,
  resolveChordForKey,
} from "../lib/chords/key-theory";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testKey(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`, error);
    process.exitCode = 1;
  }
}

const bMajor = createKeyAnalysisContext("B", "major");
const aMajor = createKeyAnalysisContext("A", "major");

testKey("B major allows B, F#sus4, G#m7, B/D#, Emaj9", () => {
  assert(isChordInKey("B", bMajor.ctx), "B");
  assert(isChordInKey("F#sus4", bMajor.ctx), "F#sus4");
  assert(isChordInKey("G#m7", bMajor.ctx), "G#m7");
  assert(isChordInKey("B/D#", bMajor.ctx), "B/D#");
  assert(isChordInKey("Emaj9", bMajor.ctx), "Emaj9");
});

testKey("B major rejects F natural and Bb major", () => {
  assert(!isChordInKey("F", bMajor.ctx), "F");
  assert(!isChordInKey("Bb", bMajor.ctx), "Bb");
  assert(!isChordInKey("Fm7", bMajor.ctx), "Fm7");
});

testKey("A major rejects Bb", () => {
  assert(!isChordInKey("Bb", aMajor.ctx), "Bb");
  assert(!isChordInKey("Bbmaj7", aMajor.ctx), "Bbmaj7");
  assert(isChordInKey("F#m7", aMajor.ctx), "F#m7");
});

testKey("OCR sharp correction Gm7 → G#m7 in B major", () => {
  const resolved = resolveChordForKey("Gm7", bMajor.ctx, bMajor.vocabulary);
  assert(resolved.accepted, "accepted");
  assert(resolved.chord === "G#m7", `expected G#m7 got ${resolved.chord}`);
});

testKey("OCR sharp correction Fsus4 → F#sus4 in B major", () => {
  const resolved = resolveChordForKey("Fsus4", bMajor.ctx, bMajor.vocabulary);
  assert(resolved.accepted, "accepted");
  assert(resolved.chord === "F#sus4", `expected F#sus4 got ${resolved.chord}`);
});

testKey("vocabulary size is substantial", () => {
  assert(bMajor.vocabulary.size > 200, `size=${bMajor.vocabulary.size}`);
});

testKey("B major scale spellings use sharps", () => {
  const ctx = buildKeyContext("B", "major");
  assert(ctx.spellingByPc.get(1) === "C#", "C#");
  assert(ctx.spellingByPc.get(6) === "F#", "F#");
});

console.log("done");
