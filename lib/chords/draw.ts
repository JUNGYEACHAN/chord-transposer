import type { ChordHighlight } from "./highlights";
import type { DetectedChord } from "./types";

/** Highlight chord-like OCR tokens in blue on the sheet. */
export function drawChordHighlights(
  ctx: CanvasRenderingContext2D,
  highlights: ChordHighlight[],
) {
  for (const item of highlights) {
    const { left, top, width, height } = item.bbox;
    const pad = 2;

    ctx.fillStyle = item.isParsedChord
      ? "rgba(59, 130, 246, 0.38)"
      : "rgba(96, 165, 250, 0.28)";
    ctx.fillRect(
      left - pad,
      top - pad,
      width + pad * 2,
      height + pad * 2,
    );

    ctx.strokeStyle = item.isParsedChord
      ? "rgba(29, 78, 216, 0.95)"
      : "rgba(37, 99, 235, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      left - pad,
      top - pad,
      width + pad * 2,
      height + pad * 2,
    );
  }
}

export function drawAnalysisPreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  options: {
    highlights?: ChordHighlight[];
  } = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  if (options.highlights?.length) {
    drawChordHighlights(ctx, options.highlights);
  }
}

/** Draw transposed chord labels over the original sheet at OCR bounding boxes. */
export function drawTransposedSheet(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  chords: DetectedChord[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  const sorted = [...chords].sort(
    (a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left,
  );

  for (const chord of sorted) {
    const { left, top, width, height } = chord.bbox;
    if (width <= 0 || height <= 0) continue;
    const padX = Math.max(3, Math.round(width * 0.15));
    const padY = Math.max(2, Math.round(height * 0.2));
    const fontSize = Math.max(11, Math.round(height * 0.92));

    ctx.font = `600 ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";

    const textWidth = ctx.measureText(chord.transposed).width;
    const eraseWidth = Math.max(width, textWidth) + padX * 2;
    const eraseHeight = height + padY * 2;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left - padX, top - padY, eraseWidth, eraseHeight);

    ctx.fillStyle = "#111111";
    ctx.fillText(chord.transposed, left, top);
  }
}

export function scaleChordsToImage(
  chords: DetectedChord[],
  ocrWidth: number,
  ocrHeight: number,
  imageWidth: number,
  imageHeight: number,
): DetectedChord[] {
  if (ocrWidth <= 0 || ocrHeight <= 0) return chords;

  const scaleX = imageWidth / ocrWidth;
  const scaleY = imageHeight / ocrHeight;

  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) {
    return chords;
  }

  return chords.map((chord) => ({
    ...chord,
    bbox: {
      left: Math.round(chord.bbox.left * scaleX),
      top: Math.round(chord.bbox.top * scaleY),
      width: Math.max(1, Math.round(chord.bbox.width * scaleX)),
      height: Math.max(1, Math.round(chord.bbox.height * scaleY)),
    },
  }));
}
