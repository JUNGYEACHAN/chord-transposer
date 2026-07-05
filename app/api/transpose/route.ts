import { NextRequest, NextResponse } from "next/server";
import { extractChordsFromOcr } from "@/lib/chords/harness";
import { semitonesBetweenKeys } from "@/lib/chords/transpose";
import type { KeyRoot } from "@/lib/chords/types";
import { resolveImageMimeType } from "@/lib/images/validate";
import { createOcrProvider } from "@/lib/ocr";
import { normalizeOcrApiKey } from "@/lib/ocr/normalize-key";

export const maxDuration = 60;

const MAX_BYTES = 1024 * 1024; // OCR.space free tier: 1 MB

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
        {
          error: `파일 크기는 ${MAX_BYTES / (1024 * 1024)}MB 이하여야 합니다. (OCR.space 무료 한도)`,
        },
        { status: 400 },
      );
    }

    const providerName = String(formData.get("provider") ?? "ocr-space");
    const fromKey = String(formData.get("fromKey") ?? "") as KeyRoot;
    const toKey = String(formData.get("toKey") ?? "") as KeyRoot;
    const preferFlats = formData.get("preferFlats") === "true";

    let semitones = Number(formData.get("semitones") ?? "0");
    if (fromKey && toKey) {
      semitones = semitonesBetweenKeys(fromKey, toKey);
    }

    const provider = createOcrProvider(providerName, apiKey);
    const ocrResult = await provider.recognize(buffer, mimeType);
    const chords = extractChordsFromOcr(ocrResult.words, ocrResult.imageHeight, {
      semitones,
      preferFlats,
    });

    return NextResponse.json({
      provider: ocrResult.provider,
      imageWidth: ocrResult.imageWidth,
      imageHeight: ocrResult.imageHeight,
      semitones,
      chords,
      wordCount: ocrResult.words.length,
      ocrWords: ocrResult.words,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
