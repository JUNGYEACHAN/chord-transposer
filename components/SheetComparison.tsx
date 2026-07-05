import type { RefObject } from "react";

interface SheetComparisonProps {
  originalUrl: string;
  resultCanvasRef: RefObject<HTMLCanvasElement | null>;
}

export default function SheetComparison({
  originalUrl,
  resultCanvasRef,
}: SheetComparisonProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          원본 · 변조 결과 대조
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          왼쪽 원본과 오른쪽 결과를 나란히 비교하세요.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            원본
          </p>
          <div className="overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={originalUrl}
              alt="원본 악보"
              className="max-w-full"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            변조 결과
          </p>
          <div className="overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <canvas ref={resultCanvasRef} className="max-w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
