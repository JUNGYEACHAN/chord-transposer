export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrResult {
  provider: string;
  words: OcrWord[];
  imageWidth: number;
  imageHeight: number;
  rawText: string;
}

export interface OcrProvider {
  readonly name: string;
  recognize(
    image: Buffer,
    mimeType: string,
    engine?: string,
  ): Promise<OcrResult>;
}

export type OcrProviderName = "ocr-space";
