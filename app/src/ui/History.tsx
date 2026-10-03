// Past checks for this plot, per block: severity over time and the list of checks.
import { Camera, Check, ClipboardList, Clock } from "lucide-react";
import type { Answers } from "../logic/answers";
import type { Lang, Observation } from "../logic/types";
import { t } from "./i18n";
import { fmtDate, SeverityMeter, StressBadge, toneOf, TrendIcon } from "./widgets";

export function History({ lang, A, obs, plotId, onCheck }: {
  lang: Lang; A: Answers; obs: Observation[]; plotId: string | null; onCheck: () => void;
}) {
  const T = (k: string) => t(lang, k);
  const mine = obs.filter((o) => o.plotId === plotId);
  if (!mine.length) {
    return (
      <main className="screen">
        <div className="empty">
          <span><ClipboardList size={36} aria-hidden /></span>
          <p>{T("no_history")}</p>
          <button className="btn primary" onClick={onCheck}><Camera size={20} aria-hidden /> {T("check_leaves")}</button>
        </div>
      </main>
    );
  }
  const blocks = [...new Set(mine.map((o) => o.block))].sort();
  return (
    <main className="screen">
      {blocks.map((b) => {
        const list = mine.filter((o) => o.block === b); // oldest first
        return (
          <section key={b} className="card">
            <div className="card-head"><h3>{T("block")} {b}</h3><span className="label">{T("severity_strip")}</span></div>
            <div className="strip">
              {list.map((o) => (
                <div key={o.id} className="bar">
                  <div className="track"><div className={`fill tone-${toneOf(o.stress, o.severity)}`} style={{ height: `${o.severity === null ? 10 : 10 + o.severity * 22.5}%` }} /></div>
                  <span>{fmtDate(o.takenAt, lang)}</span>
                </div>
              ))}
            </div>
            <ul className="list flush">
              {[...list].reverse().map((o) => (
                <li key={o.id} className="row">
                  <StressBadge stress={o.stress} size={36} />
                  <span className="row-main">
                    <b>{A.stress[o.stress][lang]}</b>
                    <span className={`row-sub tone-${toneOf(o.stress, o.severity)}`}>
                      {o.severity !== null && o.stress !== "healthy" && <><SeverityMeter level={o.severity} /> {A.severity[String(o.severity)][lang]}</>}
                      {o.trend && o.trend !== "first" && <><TrendIcon trend={o.trend} size={15} /> {A.sms.trend[o.trend][lang]}</>}
                    </span>
                    <span className="chips">
                      {o.demo && <i className="chip demo">{T("demo_label")}</i>}
                      {o.synced && !o.demo && <i className="chip ok"><Check size={12} strokeWidth={3} aria-hidden /> {T("sent")}</i>}
                      {!o.synced && <i className="chip"><Clock size={12} aria-hidden /> {T("not_sent")}</i>}
                    </span>
                  </span>
                  <span className="row-end">{fmtDate(o.takenAt, lang, true)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
