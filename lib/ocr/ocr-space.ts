import { normalizeOcrApiKey } from "./normalize-key";
import type { OcrProvider, OcrResult, OcrWord } from "./types";

interface OcrSpaceWord {
  WordText: string;
  Left: number;
  Top: number;
  Height: number;
  Width: number;
}

interface OcrSpaceLine {
  Words?: OcrSpaceWord[];
}

interface OcrSpaceOverlay {
  Lines?: OcrSpaceLine[];
}

interface OcrSpaceParsedResult {
  ParsedText?: string;
  TextOverlay?: OcrSpaceOverlay;
  ErrorMessage?: string | null;
}

interface OcrSpaceResponse {
  OCRExitCode: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[] | null;
  ParsedResults?: OcrSpaceParsedResult[];
}

function parseWords(overlay?: OcrSpaceOverlay): OcrWord[] {
  const words: OcrWord[] = [];

  for (const line of overlay?.Lines ?? []) {
    for (const word of line.Words ?? []) {
      const text = word.WordText?.trim();
      if (!text) continue;

      words.push({
        text,
        left: word.Left,
        top: word.Top,
        width: word.Width,
        height: word.Height,
        confidence: 0.9,
      });
    }
  }

  return words;
}

async function readImageDimensions(
  buffer: Buffer,
  mimeType: string,
): Promise<{ width: number; height: number }> {
  if (mimeType === "image/png" && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }

  if (
    (mimeType === "image/jpeg" || mimeType === "image/jpg") &&
    buffer.length > 4
  ) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + length;
    }
  }

  const maxBottom = parseWords(undefined).reduce(
    (max, w) => Math.max(max, w.top + w.height),
    0,
  );
  return { width: 1200, height: Math.max(maxBottom + 40, 800) };
}

export class OcrSpaceProvider implements OcrProvider {
  readonly name = "ocr-space";

  constructor(private readonly apiKey: string) {}

  private get key(): string {
    return normalizeOcrApiKey(this.apiKey);
  }

  private buildForm(image: Buffer, mimeType: string, engine: string): FormData {
    const form = new FormData();
    const base64 = image.toString("base64");
    form.append("base64Image", `data:${mimeType};base64,${base64}`);
    form.append("apikey", this.key);
    form.append("language", "eng");
    form.append("isOverlayRequired", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("OCREngine", engine);
    form.append("filetype", mimeType === "image/png" ? "PNG" : "JPG");
    return form;
  }

  private async request(
    image: Buffer,
    mimeType: string,
    engine: string,
  ): Promise<OcrSpaceResponse> {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: this.key,
      },
      body: this.buildForm(image, mimeType, engine),
    });

    const rawText = await response.text();
    let data: OcrSpaceResponse;

    if (response.status === 403) {
      try {
        const errBody = JSON.parse(rawText) as { error?: string; details?: string };
        const errMsg = errBody.error ?? "";
        if (/e555|not valid|invalid.*api key/i.test(errMsg)) {
          throw new Error(
            "OCR.space API 키가 유효하지 않습니다. Vercel의 OCR_SPACE_API_KEY 값을 확인하거나 ocr.space에서 새 키를 발급받아 주세요.",
          );
        }
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message.includes("API 키")) {
          throw parseError;
        }
      }
      throw new Error(
        "OCR.space 요청 한도 초과(403)입니다. Vercel 서버 IP의 일일 한도(500회)일 수 있습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    try {
      data = JSON.parse(rawText) as OcrSpaceResponse;
    } catch {
      throw new Error(`OCR.space HTTP ${response.status}: ${rawText.slice(0, 120)}`);
    }

    if (!response.ok) {
      throw new Error(`OCR.space HTTP ${response.status}`);
    }

    return data;
  }

  async recognize(image: Buffer, mimeType: string): Promise<OcrResult> {
    let data = await this.request(image, mimeType, "1");

    if (data.IsErroredOnProcessing || data.OCRExitCode !== 1) {
      const firstError = formatOcrSpaceError(data);
      if (/invalid free api key|e550/i.test(firstError)) {
        throw new Error(
          "OCR.space API 키가 유효하지 않습니다. ocr.space에서 새 키를 발급받아 Vercel 환경 변수를 업데이트해 주세요.",
        );
      }

      // Engine 1 failed for other reasons — retry once with engine 2.
      data = await this.request(image, mimeType, "2");
    }

    if (data.IsErroredOnProcessing || data.OCRExitCode !== 1) {
      throw new Error(formatOcrSpaceError(data));
    }

    const parsed = data.ParsedResults?.[0];
    if (!parsed) {
      throw new Error("OCR returned no parsed results");
    }

    const words = parseWords(parsed.TextOverlay);
    const dimensions = await readImageDimensions(image, mimeType);

    const maxRight = words.reduce((max, w) => Math.max(max, w.left + w.width), 0);
    const maxBottom = words.reduce((max, w) => Math.max(max, w.top + w.height), 0);

    return {
      provider: this.name,
      words,
      imageWidth: Math.max(dimensions.width, maxRight + 20),
      imageHeight: Math.max(dimensions.height, maxBottom + 20),
      rawText: parsed.ParsedText ?? "",
    };
  }
}

function formatOcrSpaceError(data: OcrSpaceResponse): string {
  const message = Array.isArray(data.ErrorMessage)
    ? data.ErrorMessage.join(", ")
    : data.ErrorMessage ??
      data.ParsedResults?.[0]?.ErrorMessage ??
      "OCR processing failed";
  return typeof message === "string" ? message : "OCR processing failed";
}

export function createOcrProvider(name: string, apiKey: string): OcrProvider {
  switch (name) {
    case "ocr-space":
      return new OcrSpaceProvider(apiKey);
    default:
      throw new Error(`Unsupported OCR provider: ${name}`);
  }
}
