// Home: start a check, see the latest result per block, and what is waiting to be sent.
import { CalendarCheck, Camera, ChevronRight, CircleCheck, Loader, MapPin, MessageSquare, Send, UserRound } from "lucide-react";
import { smsUri, visitSms } from "../handoff/sms";
import type { Answers } from "../logic/answers";
import { visitText } from "../logic/officer";
import type { Lang, Observation, Visit } from "../logic/types";
import { t } from "./i18n";
import type { Plot } from "./types";
import { fmtDate, fmtDay, SeverityMeter, StressBadge, type Tab, toneOf, TrendIcon } from "./widgets";

export function Home({ lang, plot, obs, A, queued, replies, visits, phone, offlineReady, onCheck, go }: {
  lang: Lang; plot: Plot | null; obs: Observation[]; A: Answers; queued: number; replies: number; visits: Visit[]; phone: string;
  offlineReady: boolean;
  onCheck: () => void; go: (t: Tab) => void;
}) {
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const mine = obs.filter((o) => o.plotId === plot?.plot_id);
  return (
    <main className="screen home">
      <section className="hero">
        <h2>{T("home_cta_title")}</h2>
        <p>{T("home_cta_hint")}</p>
        <button className="btn cta" onClick={onCheck}><Camera size={24} aria-hidden /> {T("check_leaves")}</button>
        {plot && <div className="hero-plot"><MapPin size={15} aria-hidden /> {T("plot")} {plot.plot_id}</div>}
      </section>

      {visits.map((v) => {
        const text = visitText(v, fmtDay(v.date, lang), A, lang);
        return (
          <section key={v.id} className="card visit">
            <div className="label"><CalendarCheck size={16} aria-hidden /> {T("visit_title")}</div>
            <b className="visit-when">{text.when}</b>
            <div className="label">{T("visit_until")}</div>
            <ul className="until">{text.until.map((u, i) => <li key={i}>{u}</li>)}</ul>
            {phone && <a className="btn secondary" href={smsUri(phone, visitSms(v, A, lang))}><MessageSquare size={20} aria-hidden /> {T("send_sms")}</a>}
          </section>
        );
      })}
      {replies > 0 && (
        <button className="notice from-officer" onClick={() => go("history")}>
          <span className="notice-icon"><UserRound size={18} aria-hidden /></span>
          <span>{T("ask_new_reply", { n: replies })}</span>
          <ChevronRight size={20} aria-hidden />
        </button>
      )}
      {queued > 0 && (
        <button className="notice" onClick={() => go("sync")}>
          <span className="notice-icon"><Send size={18} aria-hidden /></span>
          <span>{T("queued", { n: queued })}</span>
          <ChevronRight size={20} aria-hidden />
        </button>
      )}

      <h3 className="section-title">{T("latest_results")}</h3>
      {mine.length === 0 && <p className="empty-line">{T("home_empty")}</p>}
      {plot && mine.length > 0 && (
        <section className="card list">
          {plot.blocks.map((b) => {
            const o = mine.filter((x) => x.block === b).at(-1);
            return (
              <button key={b} className="row" onClick={() => go("history")}>
                {o ? <StressBadge stress={o.stress} /> : <span className="stress-badge s-none" style={{ width: 40, height: 40 }} aria-hidden>{b}</span>}
                <span className="row-main">
                  <b>{T("block")} {b}</b>
                  {o
                    ? <span className={`row-sub tone-${toneOf(o.stress, o.severity)}`}>
                        {A.stress[o.stress][lang]}
                        {o.severity !== null && o.stress !== "healthy" && <> · <SeverityMeter level={o.severity} /> {A.severity[String(o.severity)][lang]}</>}
                      </span>
                    : <span className="row-sub">{T("block_no_check")}</span>}
                </span>
                {o && <span className="row-end"><TrendIcon trend={o.trend} />{fmtDate(o.takenAt, lang)}</span>}
              </button>
            );
          })}
        </section>
      )}

      <p className={`offline-state ${offlineReady ? "ready" : ""}`}>
        {offlineReady ? <CircleCheck size={16} aria-hidden /> : <Loader size={16} className="spin" aria-hidden />}
        {T(offlineReady ? "offline_ready" : "offline_preparing")}
      </p>
    </main>
  );
}
