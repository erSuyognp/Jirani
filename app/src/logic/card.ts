// Decision Card: exactly the seven slots from the spec. All text is looked up by key; nothing is generated.
import { CONFIG } from "../config";
import { type Answers, fill, pick } from "./answers";
import type { CauseRanking } from "./causes";
import { confidenceLevel, type ConfidenceLevel } from "./refusal";
import type { TrendResult } from "./trend";
import type { Diagnosis, Lang } from "./types";

export interface CardLine { evidence: string; confirm: string | null; contextOnly: boolean; muted: boolean }

export interface Card {
  confident: boolean;
  stressKey: string;                 // healthy | miner | ... | not_sure
  stress: string;                    // 1. likely stress
  confidenceLevel: ConfidenceLevel;  // 2. confidence
  confidenceLabel: string;
  confidenceValue: number;
  reason: string | null;             // why not sure
  severityKey: number | null;
  severity: string | null;           // 3. severity + trend
  trendKey: string | null;
  trend: string | null;
  actionKey: string;
  action: string;                    // 4. one action this week
  doNot: string;                     // 5. one thing not to do
  causes: CardLine[];                // 6. likely causes
  contextNote: string | null;
  nextStepKey: "sync" | "ask_person";
  nextStep: string;                  // 7. next step
  draft: string;
  footer: string;
}

function trendText(tr: TrendResult, A: Answers, lang: Lang): string {
  const key = tr.trend !== "first" && tr.days === 0 ? `${tr.trend}_today` : tr.trend;
  return fill(pick(A.trend[key], lang, `trend.${key}`), { days: tr.days ?? 0 });
}

/** Action lookup on (stress, severityBand, trend). */
export function actionKey(dx: Diagnosis, trend: string | null): string {
  if (dx.kind === "not_sure") return "not_sure.low";
  if (dx.stress === "healthy") return "healthy.low";
  const high = dx.severity >= CONFIG.severityHighMin || trend === "worse";
  return `${dx.stress}.${high ? "high" : "low"}`;
}

export function buildCard(
  dx: Diagnosis,
  tr: TrendResult | null,
  ranking: CauseRanking,
  A: Answers,
  lang: Lang,
): Card {
  const confident = dx.kind === "confident";
  const stressKey = confident ? dx.stress : "not_sure";
  const level = confidenceLevel(confident, dx.confidence);
  const trendKey = confident && tr ? tr.trend : null;
  const aKey = actionKey(dx, trendKey);

  const causes: CardLine[] = ranking.causes.map((c) => {
    const def = A.cause[c.key];
    let evidence = pick(def.evidence, lang, `cause.${c.key}`);
    if (c.slots) {
      evidence = fill(evidence, {
        stress: pick(A.stress[c.slots.stress], lang, "stress").toLowerCase(),
        severity: pick(A.severity[String(c.slots.severity)], lang, "severity").toLowerCase(),
      });
    }
    if (c.weatherNote) evidence += " " + pick(A.cause.disease_weather.evidence, lang, "cause.disease_weather");
    if (c.contextOnly) evidence += " (" + pick(A.cause.context_only as never, lang, "cause.context_only") + ")";
    return {
      evidence,
      confirm: def.confirm ? pick(def.confirm, lang, `cause.${c.key}.confirm`) : null,
      contextOnly: c.contextOnly,
      muted: c.key === "not_covered",
    };
  });

  return {
    confident,
    stressKey,
    stress: pick(A.stress[stressKey], lang, `stress.${stressKey}`),
    confidenceLevel: level,
    confidenceLabel: pick(A.confidence[level], lang, `confidence.${level}`),
    confidenceValue: dx.confidence,
    reason: dx.kind === "not_sure" ? pick(A.not_sure_reason[dx.reason], lang, `reason.${dx.reason}`) : null,
    severityKey: confident ? dx.severity : null,
    severity: confident ? pick(A.severity[String(dx.severity)], lang, "severity") : null,
    trendKey,
    trend: confident && tr
      ? trendText(tr, A, lang)
      : pick(A.trend.none, lang, "trend.none"),
    actionKey: aKey,
    action: pick(A.action[aKey], lang, `action.${aKey}`),
    doNot: pick(A.do_not[stressKey], lang, `do_not.${stressKey}`),
    causes,
    contextNote: ranking.contextAvailable ? null : pick(A.cause.context_unavailable as never, lang, "cause.context_unavailable"),
    nextStepKey: confident ? "sync" : "ask_person",
    nextStep: pick(A.next_step[confident ? "sync" : "ask_person"], lang, "next_step"),
    draft: pick(A.card.draft, lang, "card.draft"),
    footer: pick(A.card.footer, lang, "card.footer"),
  };
}
