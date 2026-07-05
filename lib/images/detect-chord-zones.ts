/**
 * Chord-row detector (staff-anchored).
 * Staff lines are found via horizontal lineScore (robust to JPEG / note breaks).
 */

import type { ChordZoneBand, StaffSystem } from "./lead-sheet";

export interface RowProfile {
  y: number;
  inkRatio: number;
  lineScore: number;
  longestRunRatio: number;
}

export interface ChordZoneDetectionResult {
  bands: ChordZoneBand[];
  method: "staff-anchored" | "no-staff-found" | "no-chords-found";
  staffCount: number;
  staffSystems: StaffSystem[];
  chordRowCount: number;
}

const DARK_LUM = 140;
const LINE_KERNEL = 9;

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isDark(data: Uint8ClampedArray, width: number, x: number, y: number): boolean {
  const i = (y * width + x) * 4;
  return luminance(data[i], data[i + 1], data[i + 2]) < DARK_LUM;
}

function computeLineScore(
  data: Uint8ClampedArray,
  width: number,
  y: number,
): number {
  let hits = 0;
  let windows = 0;

  for (let x = 0; x + LINE_KERNEL <= width; x += 3) {
    let dark = 0;
    for (let k = 0; k < LINE_KERNEL; k++) {
      if (isDark(data, width, x + k, y)) dark++;
    }
    if (dark >= LINE_KERNEL - 2) hits++;
    windows++;
  }

  return windows > 0 ? hits / windows : 0;
}

function analyzeRow(
  data: Uint8ClampedArray,
  width: number,
  y: number,
): RowProfile {
  let dark = 0;
  let longestRun = 0;
  let run = 0;

  for (let x = 0; x < width; x++) {
    if (isDark(data, width, x, y)) {
      dark++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
  }

  return {
    y,
    inkRatio: dark / width,
    lineScore: computeLineScore(data, width, y),
    longestRunRatio: longestRun / width,
  };
}

export function buildRowProfiles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RowProfile[] {
  const profiles: RowProfile[] = [];
  for (let y = 0; y < height; y++) {
    profiles.push(analyzeRow(data, width, y));
  }
  return profiles;
}

function isStaffLineRow(row: RowProfile): boolean {
  return row.lineScore >= 0.22 && row.inkRatio >= 0.006 && row.inkRatio <= 0.62;
}

function dedupeStaffLineRows(
  lineYs: number[],
  profiles: RowProfile[],
): number[] {
  if (lineYs.length === 0) return [];

  const sorted = [...lineYs].sort((a, b) => a - b);
  const deduped: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const y = sorted[i];
    const last = deduped[deduped.length - 1];

    if (y - last <= 4) {
      if (profiles[y].lineScore > profiles[last].lineScore) {
        deduped[deduped.length - 1] = y;
      }
    } else {
      deduped.push(y);
    }
  }

  return deduped;
}

function clusterStaffLineRows(
  lineYs: number[],
  profiles: RowProfile[],
  maxLineGap: number,
  maxStaffHeight: number,
): StaffSystem[] {
  if (lineYs.length === 0) return [];

  const systems: StaffSystem[] = [];
  let group: number[] = [lineYs[0]];

  const flush = () => {
    const strong = group.filter((y) => profiles[y].lineScore >= 0.22);

    if (strong.length >= 3) {
      const span = group[group.length - 1] - group[0];
      if (span >= 6 && span <= maxStaffHeight) {
        systems.push({
          top: strong[0],
          bottom: strong[strong.length - 1],
          lineCount: strong.length,
        });
      }
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

function detectStaffPeaks(
  profiles: RowProfile[],
  height: number,
): StaffSystem[] {
  const peaks: number[] = [];

  for (let y = 2; y < height - 2; y++) {
    const row = profiles[y];
    if (row.lineScore < 0.18) continue;
    if (row.lineScore < profiles[y - 1].lineScore) continue;
    if (row.lineScore < profiles[y + 1].lineScore) continue;
    peaks.push(y);
  }

  if (peaks.length === 0) return [];

  const maxLineGap = Math.max(12, Math.round(height * 0.011));
  const maxStaffHeight = Math.max(70, Math.round(height * 0.06));

  return clusterStaffLineRows(
    dedupeStaffLineRows(peaks, profiles),
    profiles,
    maxLineGap,
    maxStaffHeight,
  );
}

function detectStaffSystems(
  profiles: RowProfile[],
  height: number,
): StaffSystem[] {
  const lineYs = dedupeStaffLineRows(
    profiles.filter(isStaffLineRow).map((row) => row.y),
    profiles,
  );

  const maxLineGap = Math.max(14, Math.round(height * 0.013));
  const maxStaffHeight = Math.max(80, Math.round(height * 0.07));
  const minSystemGap = Math.max(36, Math.round(height * 0.05));

  const raw = clusterStaffLineRows(lineYs, profiles, maxLineGap, maxStaffHeight);
  const sorted = [...raw].sort((a, b) => a.top - b.top);
  const kept: StaffSystem[] = [];

  for (const system of sorted) {
    const tooClose = kept.some(
      (k) =>
        system.top <= k.bottom + minSystemGap &&
        system.bottom >= k.top - minSystemGap,
    );
    if (!tooClose) kept.push(system);
  }

  if (kept.length > 0) return kept;

  return detectStaffPeaks(profiles, height);
}

function staffReferenceMetrics(
  profiles: RowProfile[],
  staff: StaffSystem,
): { peakInk: number; peakLineScore: number } {
  let peakInk = 0;
  let peakLineScore = 0;

  for (let y = staff.top; y <= staff.bottom; y++) {
    const row = profiles[y];
    if (!row) continue;
    peakInk = Math.max(peakInk, row.inkRatio);
    peakLineScore = Math.max(peakLineScore, row.lineScore);
  }

  return { peakInk, peakLineScore };
}

function windowBaselineMetrics(
  profiles: RowProfile[],
  windowTop: number,
  windowBottom: number,
): { ink: number; lineScore: number } {
  const inks: number[] = [];
  const scores: number[] = [];

  for (let y = windowTop; y <= windowBottom; y++) {
    const row = profiles[y];
    if (!row) continue;
    inks.push(row.inkRatio);
    scores.push(row.lineScore);
  }

  if (inks.length === 0) {
    return { ink: 0, lineScore: 0 };
  }

  inks.sort((a, b) => a - b);
  scores.sort((a, b) => a - b);
  const idx = Math.floor(inks.length * 0.2);

  return {
    ink: inks[idx] ?? inks[0],
    lineScore: scores[idx] ?? scores[0],
  };
}

function isChordInkRowRelative(
  row: RowProfile,
  staffRef: { peakInk: number; peakLineScore: number },
  baseline: { ink: number; lineScore: number },
): boolean {
  const inkLift = row.inkRatio - baseline.ink;
  const scoreLift = row.lineScore - baseline.lineScore;

  // Ignore empty rows and uniform preview-frame noise.
  if (inkLift < 0.055) return false;

  // Staff lines sit at the top of the ink/lineScore range for this system.
  if (row.inkRatio >= staffRef.peakInk - 0.06) return false;
  if (row.lineScore >= staffRef.peakLineScore - 0.08) return false;

  // Chord symbols create localized ink peaks above the window baseline.
  if (inkLift >= 0.08 || (inkLift >= 0.055 && scoreLift >= 0.04)) {
    return row.inkRatio <= 0.42;
  }

  return false;
}

export function detectChordBandAboveStaff(
  profiles: RowProfile[],
  staff: StaffSystem,
  width: number,
  height: number,
): ChordZoneBand | null {
  const gapAboveStaff = Math.max(2, Math.round(height * 0.002));
  const windowHeight = Math.max(52, Math.round(height * 0.065));

  const windowBottom = staff.top - 1;
  const windowTop = Math.max(0, windowBottom - windowHeight);

  if (windowBottom <= windowTop) return null;

  const staffRef = staffReferenceMetrics(profiles, staff);
  const baseline = windowBaselineMetrics(profiles, windowTop, windowBottom);

  const chordRows: number[] = [];
  for (let y = windowTop; y <= windowBottom; y++) {
    const row = profiles[y];
    if (row && isChordInkRowRelative(row, staffRef, baseline)) {
      chordRows.push(y);
    }
  }

  if (chordRows.length === 0) return null;

  const peakInk = Math.max(...chordRows.map((y) => profiles[y].inkRatio));
  if (chordRows.length < 2 && peakInk < 0.012) return null;

  const pad = 4;
  const top = Math.max(windowTop, chordRows[0] - pad);
  const bottom = Math.min(windowBottom, chordRows[chordRows.length - 1] + pad);
  const safeBottom = Math.min(bottom, staff.top - gapAboveStaff);

  if (safeBottom <= top) return null;

  const bandHeight = safeBottom - top + 1;
  const minHeight = Math.max(10, Math.round(height * 0.012));

  return {
    left: 0,
    top,
    width,
    height: Math.max(bandHeight, minHeight),
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
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

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

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectChordZonesFromImageData(
    imageData.data,
    canvas.width,
    canvas.height,
  );
}
