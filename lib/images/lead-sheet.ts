/**
 * Lead sheet layout (예배용 코드 악보):
 *
 *   [헤더] 제목·키·템포 (코드 있을 수 있음)
 *   ─────────────────
 *   [코드 줄]        ← 오선 바로 위
 *   [오선 5줄 + 음표]
 *   [가사]
 *   [코드 줄]        ← 다음 오선 위 (오선 “사이” 간격에도 존재)
 *   [오선 ...]
 *   ...
 *   [하단 코드]      ← 마지막 오선 아래 (아웃트로·코드 차트)
 */

export interface StaffSystem {
  top: number;
  bottom: number;
  lineCount: number;
}

export interface ChordZoneBand {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Why this band exists — useful for debugging UI */
  kind:
    | "header"
    | "above-staff"
    | "between-systems"
    | "below-last-staff"
    | "full-page";
}

export interface LeadSheetLayout {
  staffSystems: StaffSystem[];
  chordBands: ChordZoneBand[];
  method: "staff-lines" | "full-page-fallback";
}

export function mergeOverlappingBands(bands: ChordZoneBand[]): ChordZoneBand[] {
  if (bands.length === 0) return [];

  const sorted = [...bands].sort((a, b) => a.top - b.top);
  const merged: ChordZoneBand[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    const lastBottom = last.top + last.height;
    const gap = current.top - lastBottom;

    if (gap <= 6) {
      const bottom = Math.max(lastBottom, current.top + current.height);
      last.top = Math.min(last.top, current.top);
      last.left = Math.min(last.left, current.left);
      const right = Math.max(
        last.left + last.width,
        current.left + current.width,
      );
      last.width = right - last.left;
      last.height = bottom - last.top;
      if (last.kind !== current.kind) {
        last.kind = "between-systems";
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/** Build OCR bands from detected staff systems — full page height, not top-only. */
export function buildChordBandsFromStaffs(
  staffs: StaffSystem[],
  width: number,
  height: number,
): ChordZoneBand[] {
  const chordBandHeight = Math.max(52, Math.round(height * 0.07));
  const gapAboveStaff = Math.max(4, Math.round(height * 0.004));
  /** Skip lyrics directly under a staff when scanning the gap between systems */
  const lyricZoneHeight = Math.max(28, Math.round(height * 0.032));

  if (staffs.length === 0) {
    return [
      {
        left: 0,
        top: 0,
        width,
        height,
        kind: "full-page",
      },
    ];
  }

  const bands: ChordZoneBand[] = [];

  // Header: anything above the first staff
  const firstTop = staffs[0].top;
  if (firstTop > gapAboveStaff + 12) {
    bands.push({
      left: 0,
      top: 0,
      width,
      height: firstTop - gapAboveStaff,
      kind: "header",
    });
  }

  for (let i = 0; i < staffs.length; i++) {
    const staff = staffs[i];

    // Chord row directly above this staff
    const aboveBottom = Math.max(0, staff.top - gapAboveStaff);
    const aboveTop = Math.max(0, aboveBottom - chordBandHeight);
    if (aboveBottom - aboveTop >= 14) {
      bands.push({
        left: 0,
        top: aboveTop,
        width,
        height: aboveBottom - aboveTop,
        kind: "above-staff",
      });
    }

    // Between this staff and the next: chord symbols often sit in the upper
    // part of the gap (below previous lyrics, above next staff lines)
    if (i < staffs.length - 1) {
      const nextStaff = staffs[i + 1];
      const gapTop = staff.bottom + lyricZoneHeight;
      const gapBottom = nextStaff.top - gapAboveStaff;
      const gapHeight = gapBottom - gapTop;

      if (gapHeight >= 18) {
        bands.push({
          left: 0,
          top: gapTop,
          width,
          height: gapHeight,
          kind: "between-systems",
        });
      }
    }
  }

  // Footer: chords after the last staff (outro, repeat markers, chord lists)
  const lastStaff = staffs[staffs.length - 1];
  const footerTop = lastStaff.bottom + lyricZoneHeight;
  if (height - footerTop >= 18) {
    bands.push({
      left: 0,
      top: footerTop,
      width,
      height: height - footerTop,
      kind: "below-last-staff",
    });
  }

  return mergeOverlappingBands(bands);
}

export function toFlatBands(bands: ChordZoneBand[]): Omit<ChordZoneBand, "kind">[] {
  return bands.map(({ left, top, width, height }) => ({
    left,
    top,
    width,
    height,
  }));
}
