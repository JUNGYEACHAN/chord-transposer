"use client";

import { useMemo, useState } from "react";
import { parseChordSymbol } from "@/lib/chords/parser";
import { transposeChord } from "@/lib/chords/transpose";
import type { DetectedChord } from "@/lib/chords/types";

export interface EditableChord extends DetectedChord {
  id: string;
}

interface ChordCorrectionPanelProps {
  chords: EditableChord[];
  autoChords: EditableChord[];
  semitones: number;
  preferFlats: boolean;
  saving: boolean;
  saveMessage: string | null;
  saveError: string | null;
  onChange: (chords: EditableChord[]) => void;
  onSave: (notes: string) => void;
}

function chordKey(chord: EditableChord): string {
  return `${chord.id}-${chord.bbox.left}-${chord.bbox.top}`;
}

export default function ChordCorrectionPanel({
  chords,
  autoChords,
  semitones,
  preferFlats,
  saving,
  saveMessage,
  saveError,
  onChange,
  onSave,
}: ChordCorrectionPanelProps) {
  const [notes, setNotes] = useState("");
  const [newOriginal, setNewOriginal] = useState("");
  const [newTransposed, setNewTransposed] = useState("");

  const correctionCount = useMemo(() => {
    const serialize = (items: EditableChord[]) =>
      items
        .map(
          (chord) =>
            `${chord.original}|${chord.transposed}|${chord.bbox.left}|${chord.bbox.top}|${chord.bbox.width}|${chord.bbox.height}`,
        )
        .sort()
        .join(";");

    return serialize(autoChords) === serialize(chords)
      ? 0
      : Math.max(
          Math.abs(autoChords.length - chords.length),
          chords.filter((chord, index) => {
            const auto = autoChords[index];
            if (!auto) return true;
            return (
              auto.original !== chord.original ||
              auto.transposed !== chord.transposed ||
              auto.bbox.left !== chord.bbox.left ||
              auto.bbox.top !== chord.bbox.top
            );
          }).length,
        );
  }, [autoChords, chords]);

  function updateChord(id: string, patch: Partial<EditableChord>) {
    onChange(
      chords.map((chord) => (chord.id === id ? { ...chord, ...patch } : chord)),
    );
  }

  function handleOriginalChange(id: string, value: string) {
    const transposed = transposeChord(value, semitones, preferFlats);
    updateChord(id, { original: value, transposed });
  }

  function handleDelete(id: string) {
    onChange(chords.filter((chord) => chord.id !== id));
  }

  function handleAddMissed() {
    const original = newOriginal.trim();
    if (!original) return;

    const transposed =
      newTransposed.trim() ||
      transposeChord(original, semitones, preferFlats);

    onChange([
      ...chords,
      {
        id: crypto.randomUUID(),
        original,
        transposed,
        bbox: { left: 0, top: 0, width: 0, height: 0 },
        confidence: 1,
      },
    ]);

    setNewOriginal("");
    setNewTransposed("");
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          코드 수정 · 학습 저장
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          OCR이 틀린 코드를 고치면 Turso에 저장되어 이후 개선에 활용할 수
          있습니다. 위치 정보가 없는 추가 코드는 미리보기에는 그려지지 않습니다.
        </p>
      </div>

      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-600">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">원본 코드</th>
              <th className="px-3 py-2">변조 코드</th>
              <th className="px-3 py-2">위치</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {chords.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400"
                >
                  인식된 코드가 없습니다. 아래에서 누락 코드를 추가하세요.
                </td>
              </tr>
            )}
            {chords.map((chord) => {
              const validOriginal = parseChordSymbol(chord.original);
              const validTransposed = parseChordSymbol(chord.transposed);
              const hasPosition = chord.bbox.width > 0 && chord.bbox.height > 0;

              return (
                <tr
                  key={chordKey(chord)}
                  className="border-t border-zinc-200 dark:border-zinc-700"
                >
                  <td className="px-3 py-2">
                    <input
                      value={chord.original}
                      onChange={(event) =>
                        handleOriginalChange(chord.id, event.target.value)
                      }
                      className="w-full min-w-24 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-900"
                    />
                    {!validOriginal && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        코드 형식 확인
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={chord.transposed}
                      onChange={(event) =>
                        updateChord(chord.id, {
                          transposed: event.target.value,
                        })
                      }
                      className="w-full min-w-24 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-900"
                    />
                    {!validTransposed && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        코드 형식 확인
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {hasPosition
                      ? `${chord.bbox.left}, ${chord.bbox.top}`
                      : "없음"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(chord.id)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          누락 코드 추가
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={newOriginal}
            onChange={(event) => setNewOriginal(event.target.value)}
            placeholder="원본 코드 (예: F#sus4)"
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          />
          <input
            value={newTransposed}
            onChange={(event) => setNewTransposed(event.target.value)}
            placeholder="변조 코드 (비우면 자동)"
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={handleAddMissed}
            disabled={!newOriginal.trim()}
            className="rounded-lg bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-100"
          >
            추가
          </button>
        </div>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          메모 (선택)
        </span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="예: F#sus4가 F로 잘못 인식됨"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(notes)}
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "저장 중..." : "수정 내용 Turso에 저장"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          코드 {chords.length}개 · 자동 대비 수정 {correctionCount}건
        </span>
      </div>

      {saveMessage && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {saveMessage}
        </p>
      )}
      {saveError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {saveError}
        </p>
      )}
    </section>
  );
}
