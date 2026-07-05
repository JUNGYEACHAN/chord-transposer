"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChordCorrectionPanel, {
  type EditableChord,
} from "@/components/ChordCorrectionPanel";
import SheetComparison from "@/components/SheetComparison";
import {
  drawAnalysisPreview,
  drawTransposedSheet,
} from "@/lib/chords/draw";
import type { ChordHighlight } from "@/lib/chords/highlights";
import type { DetectedChord } from "@/lib/chords/types";
import { KEY_OPTIONS } from "@/lib/chords/types";
import { hashFile } from "@/lib/images/hash";
import { isImageFile, validateImageFile } from "@/lib/images/validate";
import type { OcrWord } from "@/lib/ocr/types";

interface AnalyzeResponse {
  provider: string;
  ocrEngine: string;
  imageWidth: number;
  imageHeight: number;
  semitones: number;
  chords: DetectedChord[];
  highlights: ChordHighlight[];
  wordCount: number;
  chordWordCount: number;
  ocrWords: OcrWord[];
  method: string;
  error?: string;
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

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
  });
  return image;
}

export default function TransposerApp() {
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const [analyzing, setAnalyzing] = useState(false);
  const [transposing, setTransposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [highlights, setHighlights] = useState<ChordHighlight[]>([]);
  const [autoChords, setAutoChords] = useState<EditableChord[]>([]);
  const [editableChords, setEditableChords] = useState<EditableChord[]>([]);
  const [transposed, setTransposed] = useState(false);
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

  useEffect(() => {
    if (!previewUrl) return;

    void (async () => {
      const canvas = analysisCanvasRef.current;
      if (!canvas) return;
      const image = await loadImage(previewUrl);
      drawAnalysisPreview(canvas, image, { highlights });
    })().catch((err) => {
      console.error("Preview draw failed:", err);
    });
  }, [previewUrl, highlights]);

  useEffect(() => {
    if (!transposed || !previewUrl) return;
    void (async () => {
      const image = await loadImage(previewUrl);
      const canvas = resultCanvasRef.current;
      if (canvas) drawTransposedSheet(canvas, image, editableChords);
    })().catch(() => {
      /* redraw errors are non-fatal */
    });
  }, [editableChords, transposed, previewUrl]);

  async function applyFile(selected: File) {
    const validationError = validateImageFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setAnalysis(null);
    setHighlights([]);
    setAutoChords([]);
    setEditableChords([]);
    setTransposed(false);
    setSaveMessage(null);
    setSaveError(null);
    revokePreviewUrl();

    const nextUrl = URL.createObjectURL(selected);
    previewUrlRef.current = nextUrl;
    setFile(selected);
    setPreviewUrl(nextUrl);
    setImageHash(await hashFile(selected));
  }

  async function handleAnalyze() {
    if (!file || !previewUrl) {
      setError("악보 이미지를 먼저 선택해 주세요.");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setHighlights([]);
    setAutoChords([]);
    setEditableChords([]);
    setTransposed(false);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const formData = new FormData();
      formData.append("image", file, file.name);
      formData.append("fromKey", fromKey);
      formData.append("toKey", toKey);
      formData.append("preferFlats", String(preferFlats));

      const response = await fetch("/api/analyze-chords", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as AnalyzeResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "코드 분석에 실패했습니다.");
      }

      if (data.chords.length === 0) {
        setError(
          "OCR에서 코드를 찾지 못했습니다. 더 선명한 이미지이거나 원래 키 설정을 확인해 주세요.",
        );
      }

      const editable = toEditableChords(data.chords);
      setAnalysis(data);
      setHighlights(data.highlights);
      setAutoChords(editable);
      setEditableChords(editable.map((chord) => ({ ...chord })));

      const image = await loadImage(previewUrl);
      const canvas = analysisCanvasRef.current;
      if (canvas) {
        drawAnalysisPreview(canvas, image, { highlights: data.highlights });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleTranspose() {
    if (!analysis || !previewUrl || editableChords.length === 0) {
      setError("먼저 코드 분석을 실행해 주세요.");
      return;
    }

    setTransposing(true);
    setError(null);

    try {
      const image = await loadImage(previewUrl);
      const canvas = resultCanvasRef.current;
      if (canvas) {
        drawTransposedSheet(canvas, image, editableChords);
      }
      setTransposed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "변조 중 오류");
    } finally {
      setTransposing(false);
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
    if (!analysis || !imageHash) {
      setSaveError("저장할 분석 결과가 없습니다.");
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
          semitones: analysis.semitones,
          ocrProvider: `${analysis.provider}:${analysis.ocrEngine}`,
          wordCount: analysis.wordCount,
          ocrWords: analysis.ocrWords,
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
          악보 이미지를 OCR.space API로 분석해 코드를 찾고, 파란색으로 표시한 뒤
          키 변조를 적용합니다.
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
            onDragEnter={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const dropped = pickImageFile(e.dataTransfer.files);
              if (!dropped) {
                setError("JPEG 또는 PNG 이미지를 드롭해 주세요.");
                return;
              }
              void applyFile(dropped);
            }}
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
                const selected = event.target.files?.[0] ?? null;
                if (selected) void applyFile(selected);
                event.target.value = "";
              }}
            />
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              클릭하거나 이미지를 드래그해서 업로드
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

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !file}
            className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-600"
          >
            {analyzing ? "OCR.space 분석 중..." : "1. 코드 OCR 분석"}
          </button>
          <button
            type="button"
            onClick={handleTranspose}
            disabled={transposing || !analysis || editableChords.length === 0}
            className="rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {transposing ? "변조 적용 중..." : "2. 키 변조 적용"}
          </button>
        </div>

        {analysis && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            OCR.space 엔진 {analysis.ocrEngine} · OCR 단어 {analysis.wordCount}개 ·
            코드 후보 {analysis.chordWordCount}개 · 파란 표시{" "}
            {highlights.length}개 · 병합 코드 {editableChords.length}개
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}
      </section>

      {previewUrl && (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              분석 미리보기
            </h2>
            <div className="flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-blue-400/70 ring-1 ring-blue-700" />
                OCR 코드 후보
              </span>
            </div>
          </div>
          <div className="overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <canvas ref={analysisCanvasRef} className="max-w-full" />
          </div>
        </section>
      )}

      {analysis && transposed && previewUrl && (
        <section className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <SheetComparison
            originalUrl={previewUrl}
            resultCanvasRef={resultCanvasRef}
          />

          <ChordCorrectionPanel
            chords={editableChords}
            autoChords={autoChords}
            semitones={analysis.semitones}
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
