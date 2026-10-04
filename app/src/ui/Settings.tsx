// Settings: this phone, privacy, advanced (server, timing, demo data), about.
import { FlaskConical, Globe, Info, Languages, Lock, MapPin, Server, Smartphone, Timer, Trash2, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { addObservation, clearAll, type Settings } from "../db/db";
import { gikuyuPack } from "../handoff/gikuyu";
import type { ModelMeta } from "../inference/model";
import type { Lang } from "../logic/types";
import { CardLink } from "./CardLink";
import { t } from "./i18n";
import type { Plot } from "./types";
import type { DialogSpec } from "./widgets";

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function SettingsView({ lang, settings, plots, update, model, ask, notify, onCleared }: {
  lang: Lang; settings: Settings; plots: Plot[]; update: (p: Partial<Settings>) => Promise<void>; model: ModelMeta | null;
  ask: (d: DialogSpec) => void; notify: (text: string, tone?: "ok" | "bad") => void; onCleared: () => void;
}) {
  const T = (k: string) => t(lang, k);
  const [kiPlaceholder, setKiPlaceholder] = useState(false);
  useEffect(() => { gikuyuPack().then((p) => setKiPlaceholder(p.placeholder)); }, []);

  async function addDemo() {
    if (!settings.plotId) return;
    await addObservation({
      id: uuid(), plotId: settings.plotId, block: "B",
      takenAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      stress: "rust", severity: 1, confidence: 0.9, trend: "first",
      answers: { changed: "nothing_new", sprayed: "no" }, modelVersion: model?.version ?? "demo", synced: true, demo: true,
    });
    notify(T("demo_added"), "ok");
  }

  return (
    <main className="screen">
      <h3 className="section-title">{T("section_general")}</h3>
      <section className="card form">
        <label className="field"><span><Globe size={18} aria-hidden /> {T("language")}</span>
          <select value={settings.lang} onChange={(e) => update({ lang: e.target.value as Lang })}>
            <option value="sw">{T("lang_sw")}</option><option value="en">{T("lang_en")}</option>
          </select>
        </label>
        <p className="hint"><Volume2 size={15} aria-hidden /> {T("ki_note")}{kiPlaceholder && ` ${T("ki_placeholder")}`}</p>
        <p className="hint"><Languages size={15} aria-hidden /> {T("lang_fallback")}</p>
        <label className="field"><span><MapPin size={18} aria-hidden /> {T("plot")}</span>
          <select value={settings.plotId ?? ""} onChange={(e) => update({ plotId: e.target.value, blocks: plots.find((p) => p.plot_id === e.target.value)?.blocks ?? [] })}>
            {plots.map((p) => <option key={p.plot_id} value={p.plot_id}>{p.plot_id} ({p.blocks.join(", ")})</option>)}
          </select>
        </label>
        <label className="field"><span><Smartphone size={18} aria-hidden /> {T("phone")}</span>
          <input type="tel" inputMode="tel" autoComplete="off" value={settings.phone} placeholder="+254 7…" onChange={(e) => update({ phone: e.target.value })} />
        </label>
        <p className="hint"><Lock size={15} aria-hidden /> {T("setup_phone_hint")}</p>
      </section>

      <h3 className="section-title">{T("section_privacy")}</h3>
      <section className="card form">
        <p className="hint"><Lock size={15} aria-hidden /> {T("privacy_note")}</p>
        <button className="btn danger" onClick={() => ask({
          title: T("clear_data"), body: T("clear_confirm"), confirm: T("delete"), cancel: T("cancel"), danger: true,
          onConfirm: async () => { await clearAll(); notify(T("cleared"), "ok"); onCleared(); },
        })}><Trash2 size={20} aria-hidden /> {T("clear_data")}</button>
      </section>

      <details className="card form">
        <summary>{T("section_advanced")}</summary>
        <label className="field"><span><Server size={18} aria-hidden /> {T("sync_server")}</span>
          <input type="url" inputMode="url" autoComplete="off" value={settings.serverUrl} onChange={(e) => update({ serverUrl: e.target.value })} />
        </label>
        <label className="switch"><span><Timer size={18} aria-hidden /> {T("show_latency")}</span>
          <input type="checkbox" checked={settings.showLatency} onChange={(e) => update({ showLatency: e.target.checked })} />
        </label>
        <button className="btn secondary" onClick={addDemo}><FlaskConical size={20} aria-hidden /> {T("demo_mode")}</button>
      </details>

      <h3 className="section-title">{T("section_about")}</h3>
      <section className="card about">
        <dl>
          <dt>{T("version")}</dt><dd>Jirani {__APP_VERSION__}</dd>
          {model && <><dt>{T("model")}</dt><dd>{model.version} · {(model.file_size_bytes / 1e6).toFixed(2)} MB · {model.variant} · tau {model.tau}</dd></>}
        </dl>
        <p className="hint"><Info size={15} aria-hidden /> {T("review_note")}</p>
        <CardLink lang={lang} />
      </section>
    </main>
  );
}
