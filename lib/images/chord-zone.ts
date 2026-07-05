export interface ChordZoneBand {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChordZoneDetectionResult {
  bands: ChordZoneBand[];
  method: "staff-lines" | "fallback-ratio";
  staffCount: number;
}

export function scaleChordZoneBands(
  bands: ChordZoneBand[],
  scaleX: number,
  scaleY: number,
): ChordZoneBand[] {
  return bands.map((band) => ({
    left: Math.round(band.left * scaleX),
    top: Math.round(band.top * scaleY),
    width: Math.max(1, Math.round(band.width * scaleX)),
    height: Math.max(1, Math.round(band.height * scaleY)),
  }));
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

    if (gap <= 4) {
      const bottom = Math.max(lastBottom, current.top + current.height);
      last.top = Math.min(last.top, current.top);
      last.left = Math.min(last.left, current.left);
      const right = Math.max(
        last.left + last.width,
        current.left + current.width,
      );
      last.width = right - last.left;
      last.height = bottom - last.top;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function analyzeRow(
  data: Uint8ClampedArray,
  width: number,
  y: number,
  step: number,
): { darkFraction: number; longestRunRatio: number } {
  let darkCount = 0;
  let sampled = 0;
  let longestRun = 0;
  let currentRun = 0;

  for (let x = 0; x < width; x += step) {
    const index = (y * width + x) * 4;
    const lum = luminance(data[index], data[index + 1], data[index + 2]);
    sampled++;

    if (lum < 95) {
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

interface StaffCluster {
  top: number;
  bottom: number;
  lineCount: number;
}

function clusterStaffLines(
  lineRows: number[],
  maxGap: number,
): StaffCluster[] {
  if (lineRows.length === 0) return [];

  const clusters: StaffCluster[] = [];
  let current: number[] = [lineRows[0]];

  for (let i = 1; i < lineRows.length; i++) {
    const row = lineRows[i];
    const prev = current[current.length - 1];
    if (row - prev <= maxGap) {
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

  return clusters.filter((cluster) => cluster.lineCount >= 3);
}

/** Detect horizontal bands above staff lines where chord symbols usually sit. */
export function detectChordZonesFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ChordZoneDetectionResult {
  const rowStep = width > 900 ? 2 : 1;
  const lineRows: number[] = [];

  for (let y = 0; y < height; y += rowStep) {
    const { darkFraction, longestRunRatio } = analyzeRow(
      data,
      width,
      y,
      rowStep,
    );
    if (darkFraction > 0.12 && longestRunRatio > 0.45) {
      lineRows.push(y);
    }
  }

  const maxGap = Math.max(10, Math.round(height * 0.012));
  const staffClusters = clusterStaffLines(lineRows, maxGap);
  const chordBandHeight = Math.max(48, Math.round(height * 0.06));
  const gapAboveStaff = Math.max(4, Math.round(height * 0.004));

  const bands: ChordZoneBand[] = staffClusters.map((staff) => {
    const bandBottom = Math.max(0, staff.top - gapAboveStaff);
    const bandTop = Math.max(0, bandBottom - chordBandHeight);
    return {
      left: 0,
      top: bandTop,
      width,
      height: Math.max(24, bandBottom - bandTop),
    };
  });

  if (bands.length > 0) {
    return {
      bands: mergeOverlappingBands(bands),
      method: "staff-lines",
      staffCount: staffClusters.length,
    };
  }

  return {
    bands: [
      {
        left: 0,
        top: 0,
        width,
        height: Math.max(Math.round(height * 0.35), 80),
      },
    ],
    method: "fallback-ratio",
    staffCount: 0,
  };
}

export async function detectChordZonesFromImage(
  image: HTMLImageElement,
): Promise<ChordZoneDetectionResult> {
  const canvas = document.createElement("canvas");
  const maxWidth = 1200;
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
          height: Math.round(image.naturalHeight * 0.35),
        },
      ],
      method: "fallback-ratio",
      staffCount: 0,
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
    bands: detection.bands.map((band) => ({
      left: Math.round(band.left * invScaleX),
      top: Math.round(band.top * invScaleY),
      width: Math.round(band.width * invScaleX),
      height: Math.max(1, Math.round(band.height * invScaleY)),
    })),
  };
}
