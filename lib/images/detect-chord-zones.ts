/**
 * Chord zone detector — finds horizontal bands that look like chord symbol rows.
 *
 * Strategy (does NOT use "top N%" of the page):
 * 1. Classify every scan row: staff-line | dense-text (lyrics) | sparse-text (chords) | empty
 * 2. Locate real staff systems (5 tight long horizontal lines)
 * 3. Mark staff + lyric rows as excluded
 * 4. Collect sparse-text rows + the strip above each staff across the FULL image height
 * 5. Cluster nearby rows into separate OCR bands (never merge distant bands)
 */

import type { ChordZoneBand, StaffSystem } from "./lead-sheet";

export type RowKind =
  | "empty"
  | "staff-line"
  | "dense-text"
  | "sparse-text"
  | "unknown";

export interface RowProfile {
  y: number;
  inkRatio: number;
  longestRunRatio: number;
  kind: RowKind;
}

export interface ChordZoneDetectionResult {
  bands: ChordZoneBand[];
  method: "row-sparse" | "staff-assisted" | "full-page-fallback";
  staffCount: number;
  staffSystems: StaffSystem[];
  chordRowCount: number;
}

const DARK_LUM = 112;

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function analyzeRow(
  data: Uint8ClampedArray,
  width: number,
  y: number,
  xStep: number,
): Omit<RowProfile, "kind"> {
  let dark = 0;
  let sampled = 0;
  let longestRun = 0;
  let run = 0;

  for (let x = 0; x < width; x += xStep) {
    const index = (y * width + x) * 4;
    const lum = luminance(data[index], data[index + 1], data[index + 2]);
    sampled++;

    if (lum < DARK_LUM) {
      dark++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
  }

  return {
    y,
    inkRatio: sampled > 0 ? dark / sampled : 0,
    longestRunRatio: sampled > 0 ? longestRun / sampled : 0,
  };
}

function classifyRow(row: Omit<RowProfile, "kind">): RowKind {
  const { inkRatio, longestRunRatio } = row;

  if (inkRatio < 0.007) return "empty";

  if (longestRunRatio >= 0.44 && inkRatio <= 0.24) return "staff-line";

  if (
    longestRunRatio <= 0.14 &&
    inkRatio >= 0.01 &&
    inkRatio <= 0.28
  ) {
    return "sparse-text";
  }

  if (inkRatio >= 0.035 && longestRunRatio <= 0.36) return "dense-text";

  return "unknown";
}

function buildRowProfiles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RowProfile[] {
  const xStep = width > 1100 ? 2 : 1;
  const profiles: RowProfile[] = [];

  for (let y = 0; y < height; y++) {
    const base = analyzeRow(data, width, y, xStep);
    profiles.push({ ...base, kind: classifyRow(base) });
  }

  return profiles;
}

function clusterStaffLineRows(
  lineYs: number[],
  maxLineGap: number,
  maxStaffHeight: number,
): StaffSystem[] {
  if (lineYs.length === 0) return [];

  const systems: StaffSystem[] = [];
  let group: number[] = [lineYs[0]];

  const flush = () => {
    if (group.length >= 3 && group[group.length - 1] - group[0] <= maxStaffHeight) {
      systems.push({
        top: group[0],
        bottom: group[group.length - 1],
        lineCount: group.length,
      });
    }
    group = [];
  };

  for (let i = 1; i < lineYs.length; i++) {
    const y = lineYs[i];
    const prev = group[group.length - 1];

    if (y - prev <= maxLineGap) {
      group.push(y);
    } else {
      flush();
      group = [y];
    }
  }
  flush();

  return systems;
}

function detectStaffSystems(
  profiles: RowProfile[],
  height: number,
): StaffSystem[] {
  const lineYs = profiles
    .filter((row) => row.kind === "staff-line")
    .map((row) => row.y);

  const maxLineGap = Math.max(10, Math.round(height * 0.008));
  const maxStaffHeight = Math.max(55, Math.round(height * 0.045));

  const raw = clusterStaffLineRows(lineYs, maxLineGap, maxStaffHeight);
  const sorted = [...raw].sort((a, b) => a.top - b.top);
  const kept: StaffSystem[] = [];

  for (const system of sorted) {
    const overlaps = kept.some(
      (k) => system.top <= k.bottom + 8 && system.bottom >= k.top - 8,
    );
    if (!overlaps) kept.push(system);
  }

  return kept;
}

function markExcludedRows(
  profiles: RowProfile[],
  staffSystems: StaffSystem[],
  height: number,
): boolean[] {
  const excluded = new Array<boolean>(height).fill(false);
  const noteExtension = Math.max(32, Math.round(height * 0.028));
  const lyricScanDepth = Math.max(100, Math.round(height * 0.09));

  for (let s = 0; s < staffSystems.length; s++) {
    const staff = staffSystems[s];
    const nextTop =
      s + 1 < staffSystems.length
        ? staffSystems[s + 1].top
        : Math.min(height, staff.bottom + lyricScanDepth * 2);

    for (let y = Math.max(0, staff.top - 2); y <= staff.bottom + noteExtension; y++) {
      excluded[y] = true;
    }

    const lyricEnd = Math.min(nextTop - 4, staff.bottom + lyricScanDepth);
    for (let y = staff.bottom + noteExtension + 1; y < lyricEnd; y++) {
      if (profiles[y]?.kind === "dense-text") {
        excluded[y] = true;
        for (let pad = -2; pad <= 2; pad++) {
          const py = y + pad;
          if (py >= 0 && py < height) excluded[py] = true;
        }
      }
    }
  }

  return excluded;
}

function isChordCandidateRow(row: RowProfile, excluded: boolean[]): boolean {
  if (excluded[row.y]) return false;

  if (row.kind === "sparse-text") return true;

  if (
    row.kind === "unknown" &&
    row.inkRatio >= 0.008 &&
    row.inkRatio <= 0.22 &&
    row.longestRunRatio <= 0.18
  ) {
    return true;
  }

  return false;
}

function collectChordRowYs(
  profiles: RowProfile[],
  staffSystems: StaffSystem[],
  excluded: boolean[],
  height: number,
): number[] {
  const ys = new Set<number>();
  const aboveStaffWindow = Math.max(72, Math.round(height * 0.075));

  for (const row of profiles) {
    if (isChordCandidateRow(row, excluded)) {
      ys.add(row.y);
    }
  }

  for (const staff of staffSystems) {
    const winTop = Math.max(0, staff.top - aboveStaffWindow);
    for (let y = winTop; y < staff.top - 1; y++) {
      const row = profiles[y];
      if (!row || excluded[y]) continue;
      if (row.kind === "dense-text" || row.kind === "staff-line") continue;
      if (row.inkRatio >= 0.008) ys.add(y);
    }
  }

  if (staffSystems.length > 0) {
    const last = staffSystems[staffSystems.length - 1];
    const footerStart = last.bottom + Math.max(36, Math.round(height * 0.03));
    for (let y = footerStart; y < height; y++) {
      const row = profiles[y];
      if (!row || excluded[y]) continue;
      if (row.kind === "dense-text") continue;
      if (row.inkRatio >= 0.008 && row.longestRunRatio <= 0.22) ys.add(y);
    }
  }

  return [...ys].sort((a, b) => a - b);
}

function clusterRowsToBands(
  rowYs: number[],
  width: number,
  maxRowGap: number,
): ChordZoneBand[] {
  if (rowYs.length === 0) return [];

  const bands: ChordZoneBand[] = [];
  let groupStart = rowYs[0];
  let groupEnd = rowYs[0];

  const flush = () => {
    const pad = 5;
    const top = Math.max(0, groupStart - pad);
    const bottom = groupEnd + pad;
    bands.push({
      left: 0,
      top,
      width,
      height: Math.max(14, bottom - top + 1),
      kind: "above-staff",
    });
  };

  for (let i = 1; i < rowYs.length; i++) {
    const y = rowYs[i];
    if (y - groupEnd <= maxRowGap) {
      groupEnd = y;
    } else {
      flush();
      groupStart = y;
      groupEnd = y;
    }
  }
  flush();

  return bands;
}

function inferBandKinds(
  bands: ChordZoneBand[],
  staffSystems: StaffSystem[],
  height: number,
): ChordZoneBand[] {
  if (staffSystems.length === 0) return bands;

  const firstStaffTop = staffSystems[0].top;
  const lastStaffBottom = staffSystems[staffSystems.length - 1].bottom;

  return bands.map((band) => {
    const center = band.top + band.height / 2;

    if (center < firstStaffTop - 8) {
      return { ...band, kind: "header" as const };
    }
    if (center > lastStaffBottom + Math.max(40, height * 0.03)) {
      return { ...band, kind: "below-last-staff" as const };
    }

    for (let i = 0; i < staffSystems.length - 1; i++) {
      const gapStart = staffSystems[i].bottom;
      const gapEnd = staffSystems[i + 1].top;
      if (center > gapStart && center < gapEnd) {
        return { ...band, kind: "between-systems" as const };
      }
    }

    return { ...band, kind: "above-staff" as const };
  });
}

export function detectChordZonesFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ChordZoneDetectionResult {
  const profiles = buildRowProfiles(data, width, height);
  const staffSystems = detectStaffSystems(profiles, height);
  const excluded = markExcludedRows(profiles, staffSystems, height);
  const chordRowYs = collectChordRowYs(
    profiles,
    staffSystems,
    excluded,
    height,
  );

  const maxRowGap = Math.max(18, Math.round(height * 0.014));
  let bands = clusterRowsToBands(chordRowYs, width, maxRowGap);
  bands = inferBandKinds(bands, staffSystems, height);

  let method: ChordZoneDetectionResult["method"] = "row-sparse";
  if (staffSystems.length > 0) method = "staff-assisted";
  if (bands.length === 0) {
    bands = [
      {
        left: 0,
        top: 0,
        width,
        height,
        kind: "full-page",
      },
    ];
    method = "full-page-fallback";
  }

  return {
    bands,
    method,
    staffCount: staffSystems.length,
    staffSystems,
    chordRowCount: chordRowYs.length,
  };
}

export function scaleDetectionResult(
  result: ChordZoneDetectionResult,
  scaleX: number,
  scaleY: number,
): ChordZoneDetectionResult {
  return {
    ...result,
    bands: result.bands.map((band) => ({
      ...band,
      left: Math.round(band.left * scaleX),
      top: Math.round(band.top * scaleY),
      width: Math.max(1, Math.round(band.width * scaleX)),
      height: Math.max(1, Math.round(band.height * scaleY)),
    })),
    staffSystems: result.staffSystems.map((staff) => ({
      top: Math.round(staff.top * scaleY),
      bottom: Math.round(staff.bottom * scaleY),
      lineCount: staff.lineCount,
    })),
  };
}

export async function detectChordZonesFromImage(
  image: HTMLImageElement,
): Promise<ChordZoneDetectionResult> {
  const canvas = document.createElement("canvas");
  const maxWidth = 1600;
  const scale =
    image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      bands: [
        {
          left: 0,
          top: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
          kind: "full-page",
        },
      ],
      method: "full-page-fallback",
      staffCount: 0,
      staffSystems: [],
      chordRowCount: 0,
    };
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const detection = detectChordZonesFromImageData(
    imageData.data,
    canvas.width,
    canvas.height,
  );

  if (scale === 1) return detection;

  return scaleDetectionResult(
    detection,
    image.naturalWidth / canvas.width,
    image.naturalHeight / canvas.height,
  );
}
