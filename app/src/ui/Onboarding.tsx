// First launch: welcome, then plot and basic-phone setup.
import { ArrowRight, Check, FlaskConical, Lock, MapPin, Send, Smartphone, WifiOff } from "lucide-react";
import { useState } from "react";
import type { Settings } from "../db/db";
import type { Lang } from "../logic/types";
import { t } from "./i18n";
import type { Plot } from "./types";
import { Banner, Logo } from "./widgets";

export function Welcome({ lang, onStart }: { lang: Lang; onStart: () => void }) {
  const T = (k: string) => t(lang, k);
  return (
    <>
      <main className="screen welcome">
        <div className="welcome-mark"><Logo size={52} /></div>
        <h2>{T("welcome_title")}</h2>
        <p className="lead">{T("welcome_body")}</p>
        <ul className="points">
          <li><span><WifiOff size={20} aria-hidden /></span>{T("welcome_point_offline")}</li>
          <li><span><Lock size={20} aria-hidden /></span>{T("welcome_point_private")}</li>
          <li><span><Send size={20} aria-hidden /></span>{T("welcome_point_choice")}</li>
        </ul>
      </main>
      <div className="actionbar">
        <button className="btn primary" onClick={onStart}>{T("get_started")} <ArrowRight size={20} aria-hidden /></button>
      </div>
    </>
  );
}

export function Setup({ lang, plots, settings, onSave }: {
  lang: Lang; plots: Plot[]; settings: Settings; onSave: (p: Partial<Settings>) => void;
}) {
  const T = (k: string) => t(lang, k);
  const [plotId, setPlotId] = useState(settings.plotId ?? "OND-0017");
  const [phone, setPhone] = useState(settings.phone);
  return (
    <>
      <main className="screen">
        <section className="card form">
          <label className="field"><span><MapPin size={18} aria-hidden /> {T("setup_plot")}</span>
            <select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
              {plots.map((p) => <option key={p.plot_id} value={p.plot_id}>{p.plot_id} ({p.blocks.join(", ")})</option>)}
            </select>
          </label>
          <Banner tone="warn" icon={<FlaskConical size={18} aria-hidden />}>{T("setup_registry_note")}</Banner>
        </section>
        <section className="card form">
          <label className="field"><span><Smartphone size={18} aria-hidden /> {T("setup_phone")} <em>{T("optional")}</em></span>
            <input type="tel" inputMode="tel" autoComplete="off" value={phone} placeholder="+254 7…" onChange={(e) => setPhone(e.target.value)} />
          </label>
          <p className="hint"><Lock size={15} aria-hidden /> {T("setup_phone_hint")}</p>
        </section>
      </main>
      <div className="actionbar">
        <button className="btn primary" onClick={() => onSave({ plotId, phone: phone.trim(), blocks: plots.find((p) => p.plot_id === plotId)?.blocks ?? [] })}>
          <Check size={20} aria-hidden /> {T("save")}
        </button>
      </div>
    </>
  );
}
