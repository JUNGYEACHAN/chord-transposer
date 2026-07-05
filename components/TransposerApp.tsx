"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChordCorrectionPanel, {
  type EditableChord,
} from "@/components/ChordCorrectionPanel";
import SheetComparison from "@/components/SheetComparison";
import {
  drawAnalysisPreview,
  drawTransposedSheet,
  scaleChordsToImage,
} from "@/lib/chords/draw";
import type { ChordHighlight } from "@/lib/chords/highlights";
import type { DetectedChord } from "@/lib/chords/types";
import { KEY_OPTIONS } from "@/lib/chords/types";
import { prepareMaskedOcrFile } from "@/lib/images/chord-mask";
import {
  detectChordZonesFromImage,
  type ChordZoneDetectionResult,
} from "@/lib/images/chord-zone";
import { hashFile } from "@/lib/images/hash";
import { isImageFile, validateImageFile } from "@/lib/images/validate";
import type { OcrWord } from "@/lib/ocr/types";

interface AnalyzeResponse {
  provider: string;
  imageWidth: number;
  imageHeight: number;
  semitones: number;
  chords: DetectedChord[];
  highlights: ChordHighlight[];
  wordCount: number;
  ocrWords: OcrWord[];
  chordZoneBands: { top: number; height: number; left: number; width: number }[];
  zoneMethod: string;
  staffCount: number;
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

function scaleHighlightsToImage(
  highlights: ChordHighlight[],
  ocrWidth: number,
  ocrHeight: number,
  imageWidth: number,
  imageHeight: number,
): ChordHighlight[] {
  if (ocrWidth <= 0 || ocrHeight <= 0) return highlights;
  const scaleX = imageWidth / ocrWidth;
  const scaleY = imageHeight / ocrHeight;
  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) {
    return highlights;
  }
  return highlights.map((item) => ({
    ...item,
    bbox: {
      left: Math.round(item.bbox.left * scaleX),
      top: Math.round(item.bbox.top * scaleY),
      width: Math.max(1, Math.round(item.bbox.width * scaleX)),
      height: Math.max(1, Math.round(item.bbox.height * scaleY)),
    },
  }));
}

export default function TransposerApp() {
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoneDetection, setZoneDetection] =
    useState<ChordZoneDetectionResult | null>(null);
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

  const redrawAnalysisCanvas = useCallback(
    async (nextHighlights: ChordHighlight[] = highlights) => {
      const canvas = analysisCanvasRef.current;
      if (!canvas || !previewUrl || !zoneDetection) return;

      const image = await loadImage(previewUrl);
      drawAnalysisPreview(canvas, image, {
        bands: zoneDetection.bands,
        highlights: nextHighlights,
        staffSystems: zoneDetection.staffSystems,
      });
    },
    [highlights, previewUrl, zoneDetection],
  );

  useEffect(() => {
    if (!previewUrl) return;

    let cancelled = false;

    void (async () => {
      try {
        const image = await loadImage(previewUrl);
        if (cancelled) return;

        const detection = await detectChordZonesFromImage(image);
        if (cancelled) return;

        setZoneDetection(detection);

        const canvas = analysisCanvasRef.current;
        if (canvas) {
          drawAnalysisPreview(canvas, image, {
            bands: detection.bands,
            staffSystems: detection.staffSystems,
          });
        }
      } catch {
        /* zone preview is best-effort */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!analysis) return;
    void redrawAnalysisCanvas(highlights);
  }, [analysis, highlights, redrawAnalysisCanvas]);

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
    setZoneDetection(null);
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
    if (!file || !previewUrl || !zoneDetection) {
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
      const image = await loadImage(previewUrl);
      const ocrFile = await prepareMaskedOcrFile(
        image,
        zoneDetection.bands,
        file.name,
        1024 * 1024,
      );

      const formData = new FormData();
      formData.append("image", ocrFile, ocrFile.name);
      formData.append("fromKey", fromKey);
      formData.append("toKey", toKey);
      formData.append("preferFlats", String(preferFlats));
      formData.append("provider", "ocr-space");
      formData.append("chordZoneBands", JSON.stringify(zoneDetection.bands));
      formData.append("zoneMethod", zoneDetection.method);
      formData.append("staffCount", String(zoneDetection.staffCount));

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

      const scaledChords = scaleChordsToImage(
        data.chords,
        data.imageWidth,
        data.imageHeight,
        image.naturalWidth,
        image.naturalHeight,
      );
      const scaledHighlights = scaleHighlightsToImage(
        data.highlights,
        data.imageWidth,
        data.imageHeight,
        image.naturalWidth,
        image.naturalHeight,
      );

      const editable = toEditableChords(scaledChords);
      setAnalysis(data);
      setHighlights(scaledHighlights);
      setAutoChords(editable);
      setEditableChords(editable.map((chord) => ({ ...chord })));

      const canvas = analysisCanvasRef.current;
      if (canvas) {
        drawAnalysisPreview(canvas, image, {
          bands: zoneDetection.bands,
          highlights: scaledHighlights,
          staffSystems: zoneDetection.staffSystems,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleTranspose() {
    if (!analysis || !previewUrl || editableChords.length === 0) {
      setError("먼저 코드 영역 분석을 실행해 주세요.");
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
          ocrProvider: analysis.provider,
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
          오선 위 코드 영역만 찾아 OCR하고, 코드로 보이는 글자를 파란색으로
          표시합니다. 확인 후 키 변조를 적용합니다.
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
            disabled={analyzing || !file || !zoneDetection}
            className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-600"
          >
            {analyzing ? "코드 영역 OCR 중..." : "1. 코드 영역 분석"}
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

        {zoneDetection && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            오선 {zoneDetection.staffCount}개 · 코드 줄 {zoneDetection.chordRowCount}
            행 · OCR 영역 {zoneDetection.bands.length}구간 ·{" "}
            {zoneDetection.method === "full-page-fallback"
              ? "코드 줄 미감지 → 전체 페이지"
              : zoneDetection.method === "staff-assisted"
                ? "오선+희소텍스트 분석"
                : "희소텍스트 행 분석"}
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {analysis && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            OCR 단어 {analysis.wordCount}개 · 파란 표시{" "}
            {highlights.length}개 · 병합 코드 {editableChords.length}개
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
                <span className="inline-block h-3 w-3 rounded border border-dashed border-red-500/60 bg-red-200/30" />
                감지된 오선
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border-2 border-dashed border-amber-600 bg-amber-200/40" />
                코드 OCR 영역
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-blue-400/70 ring-1 ring-blue-700" />
                코드로 보이는 글자
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
