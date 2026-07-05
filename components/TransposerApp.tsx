"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChordCorrectionPanel, {
  type EditableChord,
} from "@/components/ChordCorrectionPanel";
import SheetComparison from "@/components/SheetComparison";
import { drawTransposedSheet, scaleChordsToImage } from "@/lib/chords/draw";
import type { DetectedChord } from "@/lib/chords/types";
import { KEY_OPTIONS } from "@/lib/chords/types";
import { hashFile } from "@/lib/images/hash";
import { isImageFile, validateImageFile } from "@/lib/images/validate";
import type { OcrWord } from "@/lib/ocr/types";

interface TransposeResponse {
  provider: string;
  imageWidth: number;
  imageHeight: number;
  semitones: number;
  chords: DetectedChord[];
  wordCount: number;
  ocrWords: OcrWord[];
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

function pickImageFile(fileList: FileList | null): File | null {
  if (!fileList) return null;

  for (const file of Array.from(fileList)) {
    if (isImageFile(file)) return file;
  }

  return null;
}

function toEditableChords(chords: DetectedChord[]): EditableChord[] {
  return chords.map((chord) => ({
    ...chord,
    id: crypto.randomUUID(),
  }));
}

export default function TransposerApp() {
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fromKey, setFromKey] = useState("E");
  const [toKey, setToKey] = useState("D");
  const [preferFlats, setPreferFlats] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransposeResponse | null>(null);
  const [autoChords, setAutoChords] = useState<EditableChord[]>([]);
  const [editableChords, setEditableChords] = useState<EditableChord[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => revokePreviewUrl();
  }, [revokePreviewUrl]);

  const redrawResultCanvas = useCallback(
    async (chords: EditableChord[]) => {
      const canvas = resultCanvasRef.current;
      if (!canvas || !previewUrl) return;

      const image = new Image();
      image.src = previewUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      });

      drawTransposedSheet(canvas, image, chords);
    },
    [previewUrl],
  );

  useEffect(() => {
    if (!result || !previewUrl) return;
    void redrawResultCanvas(editableChords).catch(() => {
      /* redraw errors are non-fatal */
    });
  }, [editableChords, result, previewUrl, redrawResultCanvas]);

  async function applyFile(selected: File) {
    const validationError = validateImageFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setResult(null);
    setAutoChords([]);
    setEditableChords([]);
    setSaveMessage(null);
    setSaveError(null);
    revokePreviewUrl();

    const nextUrl = URL.createObjectURL(selected);
    previewUrlRef.current = nextUrl;
    setFile(selected);
    setPreviewUrl(nextUrl);
    setImageHash(await hashFile(selected));
  }

  function handleFileInputChange(selected: File | null) {
    if (!selected) return;
    void applyFile(selected);
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

    void applyFile(dropped);
  }

  async function handleTranspose() {
    if (!file) {
      setError("악보 이미지를 먼저 선택해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setAutoChords([]);
    setEditableChords([]);
    setSaveMessage(null);
    setSaveError(null);

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

      if (!previewUrl) return;

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

      const editable = toEditableChords(scaledChords);
      setResult(data);
      setAutoChords(editable);
      setEditableChords(editable.map((chord) => ({ ...chord })));

      const canvas = resultCanvasRef.current;
      if (canvas) {
        drawTransposedSheet(canvas, image, editable);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `transposed-${file?.name ?? "sheet.png"}`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function handleSaveCorrections(notes: string) {
    if (!result || !imageHash) {
      setSaveError("저장할 변조 결과가 없습니다.");
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageHash,
          fileName: file?.name,
          fromKey,
          toKey,
          semitones: result.semitones,
          ocrProvider: result.provider,
          wordCount: result.wordCount,
          ocrWords: result.ocrWords,
          autoChords,
          correctedChords: editableChords,
          notes: notes.trim() || undefined,
        }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "저장에 실패했습니다.");
      }

      setSaveMessage(`수정 내용이 저장되었습니다. (ID: ${data.id})`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장 중 오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Chord Transposer</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          악보 이미지에서 코드만 읽어 키 변조 후, 원래 위치에 새 코드를 그려
          PNG로 저장합니다. 원본과 결과를 나란히 비교하고 틀린 코드를 수정해
          Turso에 저장할 수 있습니다.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-zinc-950/50">
        <div className="space-y-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            악보 이미지
          </span>
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
                ? "border-zinc-900 bg-zinc-100 dark:border-zinc-400 dark:bg-zinc-800"
                : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
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
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {isDragging
                ? "여기에 놓으세요"
                : "클릭하거나 이미지를 드래그해서 업로드"}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              JPEG, PNG · 최대 1MB
            </p>
            {file && (
              <p className="mt-3 truncate text-xs text-zinc-600 dark:text-zinc-400">
                {file.name}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              원래 키
            </span>
            <select
              value={fromKey}
              onChange={(e) => setFromKey(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {KEY_OPTIONS.map((key) => (
                <option key={`from-${key}`} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              목표 키
            </span>
            <select
              value={toKey}
              onChange={(e) => setToKey(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {KEY_OPTIONS.map((key) => (
                <option key={`to-${key}`} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
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
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-600 dark:disabled:text-zinc-400"
        >
          {loading ? "OCR 및 변조 중..." : "코드 읽기 & 키 변조"}
        </button>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {result && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            OCR: <strong>{result.provider}</strong> · 인식 단어{" "}
            {result.wordCount}개 · 코드 {editableChords.length}개
          </p>
        )}
      </section>

      {result && previewUrl && (
        <section className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-zinc-950/50">
          <SheetComparison
            originalUrl={previewUrl}
            resultCanvasRef={resultCanvasRef}
          />

          <ChordCorrectionPanel
            chords={editableChords}
            autoChords={autoChords}
            semitones={result.semitones}
            preferFlats={preferFlats}
            saving={saving}
            saveMessage={saveMessage}
            saveError={saveError}
            onChange={setEditableChords}
            onSave={handleSaveCorrections}
          />

          <button
            type="button"
            onClick={handleDownload}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            변조된 악보 PNG 다운로드
          </button>
        </section>
      )}
    </div>
  );
}
