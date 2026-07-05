"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectedChord } from "@/lib/chords/types";
import { KEY_OPTIONS } from "@/lib/chords/types";
import { isImageFile, validateImageFile } from "@/lib/images/validate";

interface TransposeResponse {
  provider: string;
  imageWidth: number;
  imageHeight: number;
  semitones: number;
  chords: DetectedChord[];
  wordCount: number;
  error?: string;
}

async function resizeImageIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.sqrt(maxBytes / file.size) * 0.9;
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
    type: "image/jpeg",
  });
}

function scaleChordsToImage(
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
      width: Math.round(chord.bbox.width * scaleX),
      height: Math.round(chord.bbox.height * scaleY),
    },
  }));
}

function drawTransposedSheet(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  chords: DetectedChord[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  for (const chord of chords) {
    const { left, top, width, height } = chord.bbox;
    const padX = 4;
    const padY = 3;
    const fontSize = Math.max(12, Math.round(height * 1.05));

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      left - padX,
      top - padY,
      width + padX * 2,
      height + padY * 2,
    );

    ctx.fillStyle = "#111111";
    ctx.font = `600 ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(chord.transposed, left, top);
  }
}

function pickImageFile(fileList: FileList | null): File | null {
  if (!fileList) return null;

  for (const file of Array.from(fileList)) {
    if (isImageFile(file)) return file;
  }

  return null;
}

export default function TransposerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fromKey, setFromKey] = useState("E");
  const [toKey, setToKey] = useState("D");
  const [preferFlats, setPreferFlats] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransposeResponse | null>(null);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => revokePreviewUrl();
  }, [revokePreviewUrl]);

  useEffect(() => {
    if (!previewUrl) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const image = new Image();
    image.src = previewUrl;
    image.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      ctx.drawImage(image, 0, 0);
    };

    return () => {
      image.onload = null;
    };
  }, [previewUrl]);

  function applyFile(selected: File) {
    const validationError = validateImageFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setResult(null);
    revokePreviewUrl();

    const nextUrl = URL.createObjectURL(selected);
    previewUrlRef.current = nextUrl;
    setFile(selected);
    setPreviewUrl(nextUrl);
  }

  function handleFileInputChange(selected: File | null) {
    if (!selected) return;
    applyFile(selected);
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const dropped = pickImageFile(event.dataTransfer.files);
    if (!dropped) {
      setError("JPEG 또는 PNG 이미지를 드롭해 주세요.");
      return;
    }

    applyFile(dropped);
  }

  async function handleTranspose() {
    if (!file) {
      setError("악보 이미지를 먼저 선택해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const prepared = await resizeImageIfNeeded(file, 1024 * 1024);
      const formData = new FormData();
      formData.append("image", prepared, prepared.name);
      formData.append("fromKey", fromKey);
      formData.append("toKey", toKey);
      formData.append("preferFlats", String(preferFlats));
      formData.append("provider", "ocr-space");

      const response = await fetch("/api/transpose", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as TransposeResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "변조 요청에 실패했습니다.");
      }

      setResult(data);

      const canvas = canvasRef.current;
      if (!canvas || !previewUrl) return;

      const image = new Image();
      image.src = previewUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      });

      const scaledChords = scaleChordsToImage(
        data.chords,
        data.imageWidth,
        data.imageHeight,
        image.naturalWidth,
        image.naturalHeight,
      );

      drawTransposedSheet(canvas, image, scaledChords);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `transposed-${file?.name ?? "sheet.png"}`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Chord Transposer</h1>
        <p className="text-zinc-600">
          악보 이미지에서 코드를 읽어 키 변조 후 새 코드를 그려 줍니다.
        </p>
      </header>

      <section className="grid gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-zinc-700">악보 이미지</span>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                isDragging
                  ? "border-zinc-900 bg-zinc-100"
                  : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100",
              ].join(" ")}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(event) => {
                  handleFileInputChange(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <p className="text-sm font-medium text-zinc-800">
                {isDragging
                  ? "여기에 놓으세요"
                  : "클릭하거나 이미지를 드래그해서 업로드"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">JPEG, PNG · 최대 1MB</p>
              {file && (
                <p className="mt-3 truncate text-xs text-zinc-600">{file.name}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-zinc-700">원래 키</span>
              <select
                value={fromKey}
                onChange={(e) => setFromKey(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              >
                {KEY_OPTIONS.map((key) => (
                  <option key={`from-${key}`} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-zinc-700">목표 키</span>
              <select
                value={toKey}
                onChange={(e) => setToKey(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              >
                {KEY_OPTIONS.map((key) => (
                  <option key={`to-${key}`} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={preferFlats}
              onChange={(e) => setPreferFlats(e.target.checked)}
            />
            변환 시 플랫(b) 표기 선호
          </label>

          <button
            type="button"
            onClick={handleTranspose}
            disabled={loading || !file}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {loading ? "OCR 및 변조 중..." : "코드 읽기 & 키 변조"}
          </button>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">
              <p>
                OCR: <strong>{result.provider}</strong> · 인식 단어{" "}
                {result.wordCount}개 · 코드 {result.chords.length}개
              </p>
              <ul className="max-h-40 space-y-1 overflow-auto font-mono text-xs">
                {result.chords.map((chord) => (
                  <li key={`${chord.original}-${chord.bbox.left}-${chord.bbox.top}`}>
                    {chord.original} → {chord.transposed}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium"
              >
                PNG 다운로드
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700">미리보기</p>
          <div className="overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2">
            {previewUrl ? (
              <canvas ref={canvasRef} className="max-w-full" />
            ) : (
              <div className="flex min-h-48 items-center justify-center p-8">
                <p className="text-center text-sm text-zinc-500">
                  이미지를 업로드하면 여기에 결과가 표시됩니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
