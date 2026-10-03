// The Decision Card: the seven slots from the spec, the heatmaps, and the handoff to the basic phone.
import {
  Ban, Check, CircleCheck, FileWarning, MessageSquare, Satellite, ScanSearch, Search, Send, Share2, Square, Timer, TriangleAlert, UserRound, Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Settings } from "../db/db";
import { cardAudioFile, cardClipKeys, playKeys, shareOrDownload, stopAudio } from "../handoff/audio";
import { smsUri } from "../handoff/sms";
import type { Card } from "../logic/card";
import type { ContextPack, Lang } from "../logic/types";
import { Steps } from "./Check";
import { t } from "./i18n";
import type { Result } from "./types";
import { Banner, SeverityMeter, StressBadge, toneOf, TrendIcon } from "./widgets";

export function ResultCard({ lang, r, card: c, sms, settings, pack, onSave, notify }: {
  lang: Lang; r: Result; card: Card; sms: string; settings: Settings; pack: ContextPack | null;
  onSave: () => void; notify: (text: string, tone?: "ok" | "bad") => void;
}) {
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const [playing, setPlaying] = useState(false);
  useEffect(() => stopAudio, []);
  const packAge = pack ? Math.floor((Date.now() - Date.parse(pack.builtAt)) / 86_400_000) : null;
  const tone = toneOf(c.stressKey, c.severityKey);
  const showPct = !(r.dx.kind === "not_sure" && r.dx.reason === "too_few_good_photos");
  const dots = c.confidenceLevel === "high" ? 3 : c.confidenceLevel === "medium" ? 2 : 0;

  async function toggleAudio() {
    if (playing) { stopAudio(); setPlaying(false); return; }
    setPlaying(true);
    await playKeys(cardClipKeys(c));
    setPlaying(false);
  }
  async function share() {
    try {
      const f = await cardAudioFile(cardClipKeys(c));
      if (f && (await shareOrDownload(f)) === "downloaded") notify(T("audio_downloaded"), "ok");
    } catch { /* share sheet dismissed */ }
  }

  return (
    <>
      <main className="screen result">
        <Steps step={3} />
        <section className={`result-hero tone-${tone}`}>
          <StressBadge stress={c.stressKey} size={56} />
          <div>
            <div className="label">{T("likely_stress")}</div>
            <div className="result-title">{c.stress}</div>
            {c.reason && <p>{c.reason}</p>}
          </div>
        </section>

        <div className="stat-grid">
          <section className="card stat">
            <div className="label">{T("confidence")}</div>
            <div className={`stat-value conf-${c.confidenceLevel}`}>
              <span className="dots" aria-hidden>{[1, 2, 3].map((i) => <i key={i} className={i <= dots ? "on" : ""} />)}</span>
              {c.confidenceLabel}{showPct && <small>{Math.round(c.confidenceValue * 100)}%</small>}
            </div>
          </section>
          <section className="card stat">
            <div className="label">{T("severity_trend")}</div>
            {c.severity && <div className={`stat-value tone-${tone}`}><SeverityMeter level={c.severityKey ?? 0} /> {c.severity}</div>}
            <div className="stat-note"><TrendIcon trend={c.trendKey} /> {c.trend}</div>
          </section>
        </div>

        {r.heatmaps.length > 0 && (
          <section className="card">
            <div className="heatmaps">{r.heatmaps.map((h, i) => <img key={i} src={h} alt="" />)}</div>
            <p className="hint"><ScanSearch size={15} aria-hidden /> {T("heatmap_caption")}</p>
          </section>
        )}

        <section className="card advice do">
          <div className="label"><CircleCheck size={16} aria-hidden /> {T("action_week")}</div>
          <p>{c.action}</p>
        </section>
        <section className="card advice dont">
          <div className="label"><Ban size={16} aria-hidden /> {T("do_not")}</div>
          <p>{c.doNot}</p>
        </section>

        <section className="card">
          <div className="label"><Search size={16} aria-hidden /> {T("causes")}</div>
          <ol className="causes">
            {c.causes.map((x, i) => (
              <li key={i} className={x.muted ? "muted" : ""}>{x.evidence}{x.confirm && <span className="confirm">{T("to_confirm")} {x.confirm}</span>}</li>
            ))}
          </ol>
          {c.contextNote && <p className="hint"><TriangleAlert size={15} aria-hidden /> {c.contextNote}{packAge !== null && ` ${T("context_stale", { days: packAge })}`}</p>}
          {!c.contextNote && packAge !== null && <p className="hint"><Satellite size={15} aria-hidden /> {T("context_age", { days: packAge })}</p>}
        </section>

        <section className={`card next ${c.nextStepKey}`}>
          <div className="label">{T("next_step")}</div>
          <p className="next-text">{c.nextStepKey === "sync" ? <Send size={20} aria-hidden /> : <UserRound size={20} aria-hidden />} {c.nextStep}</p>
        </section>

        <Banner tone="warn" icon={<FileWarning size={18} aria-hidden />}>{c.draft}</Banner>

        <h3 className="section-title">{T("handoff_title")}</h3>
        <section className="card handoff">
          {settings.phone
            ? <a className="btn secondary" href={smsUri(settings.phone, sms)}><MessageSquare size={20} aria-hidden /> {T("send_sms")}</a>
            : <p className="hint">{T("no_phone")}</p>}
          <div className="split">
            <button className="btn secondary" onClick={toggleAudio}>
              {playing ? <><Square size={18} aria-hidden /> {T("stop_audio")}</> : <><Volume2 size={20} aria-hidden /> {T("play_audio")}</>}
            </button>
            <button className="btn secondary" onClick={share}><Share2 size={20} aria-hidden /> {T("share_audio")}</button>
          </div>
          <details><summary>{T("sms_preview")} ({sms.length}/160)</summary><code>{sms}</code></details>
        </section>

        {settings.showLatency && <p className="debug"><Timer size={13} aria-hidden /> {T("latency", { ms: r.ms.join(" / ") || "-" })} · model {r.obs.modelVersion}</p>}
        <p className="footnote">{c.footer}</p>
      </main>
      <div className="actionbar">
        <button className="btn primary" onClick={onSave}><Check size={20} aria-hidden /> {T("save_finish")}</button>
      </div>
    </>
  );
}
