// Trend: compare with the most recent confident observation for the same block and stress within the window.
import { CONFIG, type StressClass } from "../config";
import type { Observation, Trend } from "./types";

export interface TrendResult {
  trend: Trend;
  days: number | null;        // days since the compared observation
  previous: Observation | null;
}

const DAY = 86_400_000;

export function computeTrend(
  current: { plotId: string; block: string; stress: StressClass; severity: number; takenAt: string },
  history: Observation[],
): TrendResult {
  const now = Date.parse(current.takenAt);
  const prev = history
    .filter((o) => o.stress !== "not_sure" && o.severity !== null)
    .filter((o) => o.plotId === current.plotId && o.block === current.block && o.stress === current.stress)
    .filter((o) => {
      const t = Date.parse(o.takenAt);
      return t < now && now - t <= CONFIG.trend.windowDays * DAY;
    })
    .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt))[0];
  if (!prev) return { trend: "first", days: null, previous: null };
  const days = Math.floor((now - Date.parse(prev.takenAt)) / DAY); // 0 = earlier today
  const d = current.severity - (prev.severity as number);
  return { trend: d > 0 ? "worse" : d < 0 ? "better" : "same", days, previous: prev };
}
