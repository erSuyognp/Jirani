// F4: transparent rule-based ranking of likely causes of a yield drop. Not a model.
// Every line shown comes from answers.json by key. Thresholds are DRAFT heuristics (see config.ts).
import { CONFIG, type StressClass } from "../config";
import type { ContextPack, Diagnosis, Sprayed, Trend } from "./types";

export type CauseKey = "disease" | "dry_spell" | "soil_acidity" | "sprayed_recently" | "not_covered";

export interface Cause {
  key: CauseKey;
  score: number;
  weatherNote: boolean;     // append disease_weather line
  contextOnly: boolean;     // weather/soil fact shown while the image result is not sure
  slots?: { stress: StressClass; severity: number };
}

export interface CauseRanking {
  causes: Cause[];          // scored causes (max 3), then not_covered last
  contextAvailable: boolean;
}

const DAY = 86_400_000;

export function contextUsable(pack: ContextPack | null, now: Date): boolean {
  if (!pack) return false;
  const age = now.getTime() - Date.parse(pack.builtAt);
  return Number.isFinite(age) && age <= CONFIG.causes.contextStaleDays * DAY;
}

function warmAndWet(p: ContextPack): boolean {
  const w = CONFIG.causes.diseaseWeather;
  if (p.temp_mean_30d_c === null) return false;
  const warm = p.temp_mean_30d_c >= w.tempMinC && p.temp_mean_30d_c <= w.tempMaxC;
  const humid = p.rh_mean_30d_pct !== null && p.rh_mean_30d_pct >= w.rhMinPct;
  const wet = p.rain_30d_mm !== null && p.rain_30d_normal_mm !== null && p.rain_30d_mm > p.rain_30d_normal_mm;
  return warm && (humid || wet);
}

export function rankCauses(input: {
  diagnosis: Diagnosis;
  trend: Trend | null;
  sprayed: Sprayed;
  pack: ContextPack | null;
  now: Date;
}): CauseRanking {
  const C = CONFIG.causes;
  const { diagnosis: dx, pack } = input;
  const ctx = contextUsable(pack, input.now) ? pack : null;
  const confident = dx.kind === "confident";
  const diseased = confident && dx.stress !== "healthy";
  const scored: Cause[] = [];

  // Rule 2: context can never override a low-confidence image. No disease cause unless confident.
  if (diseased) {
    let score = C.disease.base + C.disease.perSeverity * dx.severity;
    if (input.trend === "worse") score += C.disease.worseBonus;
    const weatherNote = !!ctx && C.diseaseWeather.weatherStresses.includes(dx.stress) && warmAndWet(ctx);
    if (weatherNote) score += C.disease.weatherBonus;
    scored.push({ key: "disease", score, weatherNote, contextOnly: false, slots: { stress: dx.stress, severity: dx.severity } });
  }

  if (ctx) {
    if (ctx.rain_90d_mm !== null && ctx.rain_90d_normal_mm) {
      const ratio = ctx.rain_90d_mm / ctx.rain_90d_normal_mm;
      if (ratio < C.drySpell.ratio) {
        const score = ratio < C.drySpell.strongRatio ? C.drySpell.strongScore : C.drySpell.score;
        scored.push({ key: "dry_spell", score, weatherNote: false, contextOnly: !confident });
      }
    }
    if (ctx.soil_ph !== null && ctx.soil_ph < C.soilAcidity.phMax) {
      const score = ctx.soil_ph < C.soilAcidity.strongPhMax ? C.soilAcidity.strongScore : C.soilAcidity.score;
      scored.push({ key: "soil_acidity", score, weatherNote: false, contextOnly: !confident });
    }
  }

  if (diseased && input.sprayed === "yes") {
    scored.push({ key: "sprayed_recently", score: C.sprayedRecently.score, weatherNote: false, contextOnly: false });
  }

  scored.sort((a, b) => b.score - a.score);
  const causes = scored.slice(0, C.maxScored);
  causes.push({ key: "not_covered", score: 0, weatherNote: false, contextOnly: false });
  return { causes, contextAvailable: !!ctx };
}
