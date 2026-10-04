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

/** The extension officer's reply to an "Ask the officer" request. Picked from a fixed list on the dashboard. */
export interface OfficerReply {
  verdict: "diagnosis" | "visit" | "retake";
  stress?: StressClass;        // verdict = diagnosis
  band?: "low" | "high";       // verdict = diagnosis: selects the action text
  answeredAt: string;
}

/** Leaf photos the farmer chose to send with one check. Stays on the phone until Send is pressed. */
export interface Ask {
  id: string;                  // same id as the observation / report
  plotId: string;
  block: string;
  takenAt: string;
  images: string[];            // base64 JPEG, leaf crops, no EXIF
  status: "queued" | "sent" | "answered";
  reply?: OfficerReply;
  seen?: boolean;
}

/** A farm visit the officer has confirmed for this plot (from the dashboard's visit queue). */
export interface Visit {
  id: number;
  block: string;
  stress: string;
  date: string;                // YYYY-MM-DD
  slot: "morning" | "afternoon";
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
