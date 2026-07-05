import {
  buildChordBandsFromStaffs,
  type ChordZoneBand,
  type LeadSheetLayout,
  type StaffSystem,
} from "./lead-sheet";

export type { ChordZoneBand, StaffSystem, LeadSheetLayout };
export { mergeOverlappingBands, buildChordBandsFromStaffs } from "./lead-sheet";

export interface ChordZoneDetectionResult {
  bands: ChordZoneBand[];
  method: LeadSheetLayout["method"];
  staffCount: number;
  staffSystems: StaffSystem[];
}

export function scaleChordZoneBands(
  bands: ChordZoneBand[],
  scaleX: number,
  scaleY: number,
): ChordZoneBand[] {
  return bands.map((band) => ({
    ...band,
    left: Math.round(band.left * scaleX),
    top: Math.round(band.top * scaleY),
    width: Math.max(1, Math.round(band.width * scaleX)),
    height: Math.max(1, Math.round(band.height * scaleY)),
  }));
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function analyzeRow(
  data: Uint8ClampedArray,
  width: number,
  y: number,
  sampleStep: number,
): { darkFraction: number; longestRunRatio: number } {
  let darkCount = 0;
  let sampled = 0;
  let longestRun = 0;
  let currentRun = 0;

  for (let x = 0; x < width; x += sampleStep) {
    const index = (y * width + x) * 4;
    const lum = luminance(data[index], data[index + 1], data[index + 2]);
    sampled++;

    if (lum < 100) {
      darkCount++;
      currentRun++;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return {
    darkFraction: sampled > 0 ? darkCount / sampled : 0,
    longestRunRatio: sampled > 0 ? longestRun / sampled : 0,
  };
}

function clusterStaffLineRows(
  lineRows: number[],
  maxLineGap: number,
): StaffSystem[] {
  if (lineRows.length === 0) return [];

  const clusters: StaffSystem[] = [];
  let current: number[] = [lineRows[0]];

  for (let i = 1; i < lineRows.length; i++) {
    const row = lineRows[i];
    const prev = current[current.length - 1];
    if (row - prev <= maxLineGap) {
      current.push(row);
    } else {
      clusters.push({
        top: current[0],
        bottom: current[current.length - 1],
        lineCount: current.length,
      });
      current = [row];
    }
  }

  clusters.push({
    top: current[0],
    bottom: current[current.length - 1],
    lineCount: current.length,
  });

  return clusters.filter(
    (cluster) =>
      cluster.lineCount >= 3 ||
      (cluster.lineCount >= 2 && cluster.bottom - cluster.top >= 6),
  );
}

/** Merge staff clusters that belong to the same visual system (over-split). */
function consolidateStaffSystems(
  systems: StaffSystem[],
  minSystemGap: number,
): StaffSystem[] {
  if (systems.length <= 1) return systems;

  const sorted = [...systems].sort((a, b) => a.top - b.top);
  const merged: StaffSystem[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    const gap = current.top - last.bottom;

    if (gap < minSystemGap) {
      last.bottom = Math.max(last.bottom, current.bottom);
      last.lineCount += current.lineCount;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function detectStaffSystems(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): StaffSystem[] {
  const sampleStep = width > 1000 ? 2 : 1;
  const lineRows: number[] = [];

  // Scan the ENTIRE image height — chords/staves exist top to bottom
  for (let y = 0; y < height; y += 1) {
    const { darkFraction, longestRunRatio } = analyzeRow(
      data,
      width,
      y,
      sampleStep,
    );

    // Staff lines: long horizontal dark runs across most of the width
    if (darkFraction > 0.08 && longestRunRatio > 0.38) {
      lineRows.push(y);
    }
  }

  const maxLineGap = Math.max(8, Math.round(height * 0.01));
  const minSystemGap = Math.max(24, Math.round(height * 0.022));

  const clustered = clusterStaffLineRows(lineRows, maxLineGap);
  return consolidateStaffSystems(clustered, minSystemGap);
}

export function detectLeadSheetLayout(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): LeadSheetLayout {
  const staffSystems = detectStaffSystems(data, width, height);
  const chordBands = buildChordBandsFromStaffs(staffSystems, width, height);

  return {
    staffSystems,
    chordBands,
    method: staffSystems.length > 0 ? "staff-lines" : "full-page-fallback",
  };
}

/** Detect chord OCR zones from a lead sheet image (full height). */
export function detectChordZonesFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ChordZoneDetectionResult {
  const layout = detectLeadSheetLayout(data, width, height);

  return {
    bands: layout.chordBands,
    method: layout.method,
    staffCount: layout.staffSystems.length,
    staffSystems: layout.staffSystems,
  };
}

export async function detectChordZonesFromImage(
  image: HTMLImageElement,
): Promise<ChordZoneDetectionResult> {
  const canvas = document.createElement("canvas");
  const maxWidth = 1400;
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

  const invScaleX = image.naturalWidth / canvas.width;
  const invScaleY = image.naturalHeight / canvas.height;

  return {
    ...detection,
    bands: scaleChordZoneBands(detection.bands, invScaleX, invScaleY),
    staffSystems: detection.staffSystems.map((staff) => ({
      top: Math.round(staff.top * invScaleY),
      bottom: Math.round(staff.bottom * invScaleY),
      lineCount: staff.lineCount,
    })),
  };
}
