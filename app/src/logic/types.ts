import type { StressClass } from "../config";

export type Lang = "en" | "sw";
export type Trend = "first" | "worse" | "same" | "better";
export type NotSureReason = "too_few_good_photos" | "low_confidence" | "leaves_disagree";
export type Changed = "leaves_falling" | "spots_spreading" | "fewer_cherries" | "nothing_new";
export type Sprayed = "yes" | "no" | "unknown";

export interface LeafResult {
  probs: number[];      // calibrated stress probabilities (temperature applied)
  stress: StressClass;  // argmax
  pMax: number;
  severity: number;     // argmax of severity head
  ms: number;           // inference time
  features?: Float32Array; // C x 7 x 7 feature map for CAM
}

export type Diagnosis =
  | { kind: "confident"; stress: StressClass; severity: number; confidence: number; pMean: number[]; agreeing: number[] }
  | { kind: "not_sure"; reason: NotSureReason; confidence: number; pMean: number[] | null };

export interface Observation {
  id: string;
  plotId: string;
  block: string;
  takenAt: string;
  stress: StressClass | "not_sure";
  severity: number | null;
  confidence: number;
  reason?: string;
  trend?: Trend | null;
  answers: { changed: Changed; sprayed: Sprayed };
  modelVersion: string;
  synced: boolean;
  demo?: boolean;
}

export interface ContextPack {
  plotId: string;
  builtAt: string;
  source: { weather: string; soil: string };
  rain_30d_mm: number | null;
  rain_30d_normal_mm: number | null;
  rain_90d_mm: number | null;
  rain_90d_normal_mm: number | null;
  temp_mean_30d_c: number | null;
  rh_mean_30d_pct: number | null;
  soil_ph: number | null;
  caveat: string;
  synthetic_location?: boolean;
}
