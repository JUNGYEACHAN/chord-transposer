/**
 * Lead sheet layout types shared across detectors and UI.
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
  kind:
    | "header"
    | "above-staff"
    | "between-systems"
    | "below-last-staff"
    | "full-page";
}
