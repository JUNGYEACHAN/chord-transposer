"use client";

import { useEffect, useRef, useState } from "react";
import type { DetectedChord } from "@/lib/chords/types";
import { KEY_OPTIONS } from "@/lib/chords/types";

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

export default function TransposerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fromKey, setFromKey] = useState("E");
  const [toKey, setToKey] = useState("D");
  const [preferFlats, setPreferFlats] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransposeResponse | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  async function handleFileChange(selected: File | null) {
    setError(null);
    setResult(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
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
      formData.append("image", prepared);
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

      drawTransposedSheet(canvas, image, data.chords);
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
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">악보 이미지</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="block w-full text-sm"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          </label>

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
            <canvas ref={canvasRef} className="max-w-full" />
            {!previewUrl && (
              <p className="p-8 text-center text-sm text-zinc-500">
                이미지를 업로드하면 여기에 결과가 표시됩니다.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
