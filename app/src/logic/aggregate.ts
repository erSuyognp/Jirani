// Three-leaf aggregation: mean calibrated probabilities, then the refusal gate.
import { STRESS_CLASSES } from "../config";
import { refusalReason } from "./refusal";
import type { Diagnosis, LeafResult } from "./types";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** leaves = results for photos that passed the quality gate (up to 3). */
export function aggregate(leaves: LeafResult[], tau: number): Diagnosis {
  if (leaves.length === 0) return { kind: "not_sure", reason: "too_few_good_photos", confidence: 0, pMean: null };
  const n = STRESS_CLASSES.length;
  const pMean = Array.from({ length: n }, (_, k) => leaves.reduce((a, l) => a + l.probs[k], 0) / leaves.length);
  let c = 0;
  for (let k = 1; k < n; k++) if (pMean[k] > pMean[c]) c = k;
  const candidate = STRESS_CLASSES[c];
  const agreeing = leaves.map((l, i) => (l.stress === candidate ? i : -1)).filter((i) => i >= 0);
  const confidence = pMean[c];

  const reason = refusalReason({ goodPhotos: leaves.length, pMeanMax: confidence, votes: agreeing.length, tau });
  if (reason) return { kind: "not_sure", reason, confidence, pMean };

  const severity = candidate === "healthy" ? 0 : Math.max(1, median(agreeing.map((i) => leaves[i].severity)));
  return { kind: "confident", stress: candidate, severity, confidence, pMean, agreeing };
}
