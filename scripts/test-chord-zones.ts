import sharp from "sharp";
import {
  detectChordBandAboveStaff,
  detectChordZonesFromImageData,
  buildRowProfiles,
} from "../lib/images/detect-chord-zones";

const screenshot =
  "/Users/imna/.cursor/projects/Users-imna-Projects-chord-transposer/assets/___________2026-07-05______8.29.39-6b4d17b1-19b7-42b9-b928-bf036fe82778.png";

async function main() {
  const meta = await sharp(screenshot).metadata();
  const h = meta.height ?? 571;
  const w = meta.width ?? 1024;
  const { data, info } = await sharp(screenshot)
    .extract({
      left: 0,
      top: Math.round(h * 0.47),
      width: w,
      height: Math.round(h * 0.53),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buf = new Uint8ClampedArray(data);
  const result = detectChordZonesFromImageData(buf, info.width, info.height);
  const profiles = buildRowProfiles(buf, info.width, info.height);

  console.log("staffs", result.staffSystems);

  for (const staff of result.staffSystems) {
    const band = detectChordBandAboveStaff(
      profiles,
      staff,
      info.width,
      info.height,
    );
    console.log("staff", staff.top, "band", band);

    const gap = 4;
    const wh = Math.max(52, Math.round(info.height * 0.065));
    const wb = staff.top - gap;
    const wt = Math.max(0, wb - wh);
    let hits = 0;
    for (let y = wt; y <= wb; y++) {
      const row = profiles[y];
      const isChord =
        row.inkRatio >= 0.012 &&
        row.lineScore < 0.24 &&
        !(
          row.inkRatio >= 0.038 &&
          row.longestRunRatio >= 0.06 &&
          row.longestRunRatio <= 0.34
        );
      if (isChord && row.lineScore <= 0.22 && row.inkRatio <= 0.38) hits++;
      if (y % 5 === 0 || isChord) {
        console.log(
          `  y=${y} ink=${row.inkRatio.toFixed(3)} ls=${row.lineScore.toFixed(3)} chord?=${isChord}`,
        );
      }
    }
    console.log(`  chord-like rows in window: ${hits}`);
  }
}

main();
