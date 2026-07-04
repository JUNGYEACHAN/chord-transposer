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

  async recognize(image: Buffer, mimeType: string): Promise<OcrResult> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(image)], { type: mimeType });
    form.append("file", blob, `sheet.${mimeType.split("/")[1] ?? "png"}`);
    form.append("apikey", this.apiKey);
    form.append("language", "eng");
    form.append("isOverlayRequired", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("OCREngine", "2");

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      throw new Error(`OCR.space HTTP ${response.status}`);
    }

    const data = (await response.json()) as OcrSpaceResponse;

    if (data.IsErroredOnProcessing || data.OCRExitCode !== 1) {
      const message = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join(", ")
        : data.ErrorMessage ??
          data.ParsedResults?.[0]?.ErrorMessage ??
          "OCR processing failed";
      throw new Error(message);
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

export function createOcrProvider(name: string, apiKey: string): OcrProvider {
  switch (name) {
    case "ocr-space":
      return new OcrSpaceProvider(apiKey);
    default:
      throw new Error(`Unsupported OCR provider: ${name}`);
  }
}
