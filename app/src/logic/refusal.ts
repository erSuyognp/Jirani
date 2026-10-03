// The refusal gate. When any check fails, the only legal output is "not sure".
import { CONFIG } from "../config";
import type { NotSureReason } from "./types";

export interface GateInput {
  goodPhotos: number;   // photos that passed the quality gate
  pMeanMax: number;     // max of the mean calibrated probability vector
  votes: number;        // leaves whose own argmax equals the candidate
  tau: number;
}

/** Returns null when the result may be shown, or the reason it must be "not sure". */
export function refusalReason(g: GateInput): NotSureReason | null {
  if (g.goodPhotos < CONFIG.aggregate.minGoodPhotos) return "too_few_good_photos";
  if (!(g.pMeanMax >= g.tau)) return "low_confidence"; // also catches NaN
  if (g.votes < CONFIG.aggregate.minAgreeingLeaves) return "leaves_disagree";
  return null;
}

export type ConfidenceLevel = "high" | "medium" | "not_sure";

export function confidenceLevel(confident: boolean, p: number): ConfidenceLevel {
  if (!confident) return "not_sure";
  return p >= CONFIG.aggregate.highConfidence ? "high" : "medium";
}
