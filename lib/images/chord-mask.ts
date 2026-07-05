import type { ChordZoneBand } from "./chord-zone";

/** Keep only chord-zone pixels; white out lyrics and staff for cleaner OCR. */
export function createMaskedOcrCanvas(
  image: HTMLImageElement,
  bands: ChordZoneBand[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const band of bands) {
    ctx.drawImage(
      image,
      band.left,
      band.top,
      band.width,
      band.height,
      band.left,
      band.top,
      band.width,
      band.height,
    );
  }

  return canvas;
}

export async function maskedOcrCanvasToBlob(
  canvas: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob> {
  let quality = 0.92;

  for (let attempt = 0; attempt < 6; attempt++) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) break;
    if (blob.size <= maxBytes) return blob;
    quality -= 0.12;
  }

  const fallback = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.7),
  );
  if (!fallback) {
    throw new Error("OCR용 이미지를 생성하지 못했습니다.");
  }
  return fallback;
}

export async function prepareMaskedOcrFile(
  image: HTMLImageElement,
  bands: ChordZoneBand[],
  fileName: string,
  maxBytes: number,
): Promise<File> {
  const canvas = createMaskedOcrCanvas(image, bands);
  const blob = await maskedOcrCanvasToBlob(canvas, maxBytes);
  const safeName = fileName.replace(/\.\w+$/, "") || "sheet";
  return new File([blob], `${safeName}-chords.jpg`, { type: "image/jpeg" });
}
