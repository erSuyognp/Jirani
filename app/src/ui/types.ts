import type { CauseRanking } from "../logic/causes";
import type { Harvest } from "../logic/harvest";
import type { TrendResult } from "../logic/trend";
import type { Changed, Diagnosis, Observation, Sprayed } from "../logic/types";

export interface Plot { plot_id: string; lat: number; lon: number; blocks: string[] }

/** One finished check. The card and the SMS are derived from this, so they follow the language switch. */
export interface Result {
  dx: Diagnosis;
  trend: TrendResult | null;
  ranking: CauseRanking;
  harvest: Harvest;
  heatmaps: string[];
  obs: Observation;
  at: Date;
  ms: number[];
}

export interface CheckAnswers { block: string; changed: Changed | null; sprayed: Sprayed | null }
