import { NextRequest, NextResponse } from "next/server";
import type { DetectedChord } from "@/lib/chords/types";
import { saveCorrectionRecord } from "@/lib/db/corrections";
import { isTursoConfigured } from "@/lib/db/client";
import type { OcrWord } from "@/lib/ocr/types";

interface CorrectionRequestBody {
  imageHash?: string;
  fileName?: string;
  fromKey?: string;
  toKey?: string;
  semitones?: number;
  ocrProvider?: string;
  wordCount?: number;
  ocrWords?: OcrWord[];
  autoChords?: DetectedChord[];
  correctedChords?: DetectedChord[];
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    if (!isTursoConfigured()) {
      return NextResponse.json(
        {
          error:
            "Turso가 설정되지 않았습니다. TURSO_DATABASE_URL과 TURSO_AUTH_TOKEN을 추가해 주세요.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as CorrectionRequestBody;

    if (!body.imageHash?.trim()) {
      return NextResponse.json(
        { error: "imageHash가 필요합니다." },
        { status: 400 },
      );
    }
    if (!body.fromKey || !body.toKey) {
      return NextResponse.json(
        { error: "fromKey와 toKey가 필요합니다." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.autoChords) || !Array.isArray(body.correctedChords)) {
      return NextResponse.json(
        { error: "autoChords와 correctedChords 배열이 필요합니다." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.ocrWords)) {
      return NextResponse.json(
        { error: "ocrWords 배열이 필요합니다." },
        { status: 400 },
      );
    }

    const { id } = await saveCorrectionRecord({
      imageHash: body.imageHash.trim(),
      fileName: body.fileName,
      fromKey: body.fromKey,
      toKey: body.toKey,
      semitones: Number(body.semitones ?? 0),
      ocrProvider: body.ocrProvider,
      wordCount: body.wordCount,
      ocrWords: body.ocrWords,
      autoChords: body.autoChords,
      correctedChords: body.correctedChords,
      notes: body.notes,
    });

    return NextResponse.json({ id, saved: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
