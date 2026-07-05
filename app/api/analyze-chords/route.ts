import { NextRequest, NextResponse } from "next/server";
import { semitonesBetweenKeys } from "@/lib/chords/transpose";
import type { KeyRoot } from "@/lib/chords/types";
import { isTursoConfigured } from "@/lib/db/client";
import { saveSuccessRecord } from "@/lib/db/success-records";
import { resolveImageMimeType } from "@/lib/images/validate";
import { analyzeLeadSheetImage } from "@/lib/ocr/analyze-sheet";
import { normalizeOcrApiKey } from "@/lib/ocr/normalize-key";

export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const apiKey = normalizeOcrApiKey(process.env.OCR_SPACE_API_KEY ?? "");
    if (!apiKey) {
      return NextResponse.json(
        { error: "OCR_SPACE_API_KEY 환경 변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "image 파일이 필요합니다." },
        { status: 400 },
      );
    }

    const mimeType = resolveImageMimeType(file);
    if (!mimeType) {
      return NextResponse.json(
        { error: "JPEG 또는 PNG 이미지만 지원합니다." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "파일 크기는 8MB 이하여야 합니다." },
        { status: 400 },
      );
    }

    const fromKey = String(formData.get("fromKey") ?? "") as KeyRoot;
    const toKey = String(formData.get("toKey") ?? "") as KeyRoot;
    const preferFlats = formData.get("preferFlats") === "true";
    const imageHash = String(formData.get("imageHash") ?? "").trim();
    const fileName = String(formData.get("fileName") ?? file.name);

    let semitones = 0;
    if (fromKey && toKey) {
      semitones = semitonesBetweenKeys(fromKey, toKey);
    }

    const analysis = await analyzeLeadSheetImage(buffer, mimeType, apiKey, {
      semitones,
      preferFlats,
      fromKey: fromKey || undefined,
    });

    let successRecordId: string | null = null;
    if (
      analysis.chords.length > 0 &&
      imageHash &&
      isTursoConfigured()
    ) {
      try {
        const saved = await saveSuccessRecord({
          imageHash,
          fileName,
          fromKey: fromKey || "?",
          toKey: toKey || "?",
          semitones,
          ocrProvider: analysis.provider,
          ocrEngine: analysis.engine,
          tileCount: analysis.tileCount,
          wordCount: analysis.wordCount,
          chordCount: analysis.chords.length,
          ocrWords: analysis.words,
          chords: analysis.chords,
        });
        successRecordId = saved.id;
      } catch (err) {
        console.error("Failed to save success record:", err);
      }
    }

    return NextResponse.json({
      provider: analysis.provider,
      ocrEngine: analysis.engine,
      tileCount: analysis.tileCount,
      imageWidth: analysis.imageWidth,
      imageHeight: analysis.imageHeight,
      semitones,
      chords: analysis.chords,
      highlights: analysis.highlights,
      wordCount: analysis.wordCount,
      chordWordCount: analysis.chordWords.length,
      ocrWords: analysis.words,
      method: "ocr-space-full-page",
      keyFilter: analysis.keyFilter ?? null,
      successRecordId,
      successSaved: Boolean(successRecordId),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
