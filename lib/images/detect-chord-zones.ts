/**
 * Chord-row detector (staff-anchored).
 *
 * Lead sheet layout per system:
 *   [chord row]  ← ONLY this becomes an OCR band (if ink found)
 *   [5-line staff + notes]  ← never OCR
 *   [lyrics]  ← never OCR
 *
 * Rules:
 * - One band max per staff system, strictly above staff.top
 * - No band if the chord strip is empty (e.g. intro line with no chords)
 * - Never merge bands across different staves
 * - No full-page or top-percent fallback
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
  method: "staff-anchored" | "no-staff-found" | "no-chords-found";
  staffCount: number;
  staffSystems: StaffSystem[];
  /** Staff systems that had a chord band created */
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

  if (longestRunRatio >= 0.38 && inkRatio <= 0.28) return "staff-line";

  if (inkRatio >= 0.04 && longestRunRatio >= 0.06 && longestRunRatio <= 0.34) {
    return "dense-text";
  }

  if (
    longestRunRatio <= 0.11 &&
    inkRatio >= 0.012 &&
    inkRatio <= 0.24
  ) {
    return "sparse-text";
  }

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
    if (
      group.length >= 4 &&
      group[group.length - 1] - group[0] <= maxStaffHeight
    ) {
      systems.push({
        top: group[0],
        bottom: group[group.length - 1],
        lineCount: group.length,
      });
    } else if (
      group.length >= 3 &&
      group[group.length - 1] - group[0] <= maxStaffHeight * 0.85
    ) {
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
    .filter(
      (row) =>
        row.kind === "staff-line" ||
        (row.longestRunRatio >= 0.42 && row.inkRatio <= 0.22),
    )
    .map((row) => row.y);

  const maxLineGap = Math.max(9, Math.round(height * 0.007));
  const maxStaffHeight = Math.max(42, Math.round(height * 0.038));

  const raw = clusterStaffLineRows(lineYs, maxLineGap, maxStaffHeight);
  const sorted = [...raw].sort((a, b) => a.top - b.top);
  const kept: StaffSystem[] = [];

  for (const system of sorted) {
    const overlaps = kept.some(
      (k) => system.top <= k.bottom + 6 && system.bottom >= k.top - 6,
    );
    if (!overlaps) kept.push(system);
  }

  return kept;
}

function isChordInkRow(row: RowProfile): boolean {
  if (row.kind === "empty") return false;
  if (row.kind === "staff-line") return false;
  if (row.kind === "dense-text") return false;

  if (row.longestRunRatio >= 0.28) return false;

  if (
    row.inkRatio >= 0.038 &&
    row.longestRunRatio >= 0.07 &&
    row.longestRunRatio <= 0.32
  ) {
    return false;
  }

  if (row.kind === "sparse-text") return true;

  if (
    row.inkRatio >= 0.012 &&
    row.inkRatio <= 0.22 &&
    row.longestRunRatio <= 0.1
  ) {
    return true;
  }

  return false;
}

function detectChordBandAboveStaff(
  profiles: RowProfile[],
  staff: StaffSystem,
  width: number,
  height: number,
): ChordZoneBand | null {
  const gapAboveStaff = Math.max(4, Math.round(height * 0.004));
  const windowHeight = Math.max(48, Math.round(height * 0.055));

  const windowBottom = staff.top - gapAboveStaff;
  const windowTop = Math.max(0, windowBottom - windowHeight);

  if (windowBottom <= windowTop) return null;

  const chordRows: number[] = [];
  for (let y = windowTop; y <= windowBottom; y++) {
    const row = profiles[y];
    if (row && isChordInkRow(row)) {
      chordRows.push(y);
    }
  }

  if (chordRows.length === 0) return null;

  const peakInk = Math.max(...chordRows.map((y) => profiles[y].inkRatio));
  if (chordRows.length < 2 && peakInk < 0.02) return null;

  const pad = 3;
  const top = Math.max(windowTop, chordRows[0] - pad);
  const bottom = Math.min(windowBottom, chordRows[chordRows.length - 1] + pad);

  const safeBottom = Math.min(bottom, staff.top - gapAboveStaff);
  if (safeBottom <= top) return null;

  return {
    left: 0,
    top,
    width,
    height: safeBottom - top + 1,
    kind: "above-staff",
  };
}

export function detectChordZonesFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ChordZoneDetectionResult {
  const profiles = buildRowProfiles(data, width, height);
  const staffSystems = detectStaffSystems(profiles, height);

  if (staffSystems.length === 0) {
    return {
      bands: [],
      method: "no-staff-found",
      staffCount: 0,
      staffSystems: [],
      chordRowCount: 0,
    };
  }

  const bands: ChordZoneBand[] = [];

  for (const staff of staffSystems) {
    const band = detectChordBandAboveStaff(profiles, staff, width, height);
    if (band) bands.push(band);
  }

  return {
    bands,
    method: bands.length > 0 ? "staff-anchored" : "no-chords-found",
    staffCount: staffSystems.length,
    staffSystems,
    chordRowCount: bands.length,
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
      bands: [],
      method: "no-staff-found",
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
