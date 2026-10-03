import { useEffect, useRef, useState } from "react";
import { STRESS_CLASSES } from "../config";
import {
  addObservation, allObservations, clearAll, DEFAULT_SETTINGS, getSettings, saveSettings, type Packet, type Settings,
} from "../db/db";
import { cardAudioFile, cardClipKeys, playKeys, shareOrDownload } from "../handoff/audio";
import { buildSms, smsUri } from "../handoff/sms";
import { loadModel, type ModelMeta, type StressHead } from "../inference/model";
import { heatmapFor, type Photo, processPhoto } from "../inference/pipeline";
import { aggregate } from "../logic/aggregate";
import type { Answers } from "../logic/answers";
import { buildCard, type Card } from "../logic/card";
import { rankCauses } from "../logic/causes";
import { computeTrend, type TrendResult } from "../logic/trend";
import type { Changed, ContextPack, Diagnosis, Lang, Observation, Sprayed } from "../logic/types";
import { pending, queue, send } from "../sync/outbox";
import { loadStrings, t } from "./i18n";

const BASE = import.meta.env.BASE_URL;
type Screen = "home" | "setup" | "capture" | "questions" | "card" | "history" | "sync" | "settings";
interface Plot { plot_id: string; lat: number; lon: number; blocks: string[] }
interface Result { dx: Diagnosis; trend: TrendResult | null; card: Card; heatmaps: string[]; obs: Observation; sms: string; ms: number[] }

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const ICON: Record<string, string> = {
  healthy: "🌿", miner: "🐛", rust: "🟠", phoma: "🟤", cercospora: "⚫", not_sure: "❓",
};

export default function App() {
  const [ready, setReady] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [S, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [A, setA] = useState<Answers | null>(null);
  const [model, setModel] = useState<{ meta: ModelMeta; head: StressHead } | null>(null);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [queued, setQueued] = useState(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<{ block: string; changed: Changed | null; sprayed: Sprayed | null }>({ block: "", changed: null, sprayed: null });
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const L: Lang = S.lang;
  const tr = (k: string, v?: Record<string, string | number>) => t(L, k, v);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    (async () => {
      try {
        await loadStrings(BASE);
        const s = await getSettings();
        setS(s);
        setA(await (await fetch(`${BASE}content/answers.json`)).json());
        setPlots((await (await fetch(`${BASE}content/plots.json`)).json()).plots);
        setModel(await loadModel());
        setQueued((await pending()).length);
        setReady("ok");
        if (!s.plotId) setScreen("setup");
      } catch (e) {
        setErr(String(e));
        setReady("error");
      }
    })();
    // service worker: "Offline ready" once everything is precached
    import("virtual:pwa-register").then(({ registerSW }) => {
      registerSW({ immediate: true, onOfflineReady: () => { setOfflineReady(true); try { localStorage.setItem("jirani-offline", "1"); } catch { /* ignore */ } } });
    }).catch(() => undefined);
    try { if (localStorage.getItem("jirani-offline") && navigator.serviceWorker?.controller) setOfflineReady(true); } catch { /* ignore */ }
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (!S.plotId) return;
    fetch(`${BASE}context/${S.plotId}.json`).then((r) => (r.ok ? r.json() : null)).then(setPack).catch(() => setPack(null));
  }, [S.plotId]);

  async function updateSettings(p: Partial<Settings>) {
    const n = { ...S, ...p };
    setS(n);
    await saveSettings(n);
  }

  function startCheck() {
    setPhotos([]);
    setResult(null);
    setSaved(false);
    setQ({ block: S.blocks.includes("B") ? "" : "", changed: null, sprayed: null });
    setScreen("capture");
  }

  // Dev-only test hook: feed sample photos without a camera (stripped from production builds).
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__jiraniAddPhoto = (b: Blob) => addPhoto(b);
  });

  async function addPhoto(f: Blob | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const p = await processPhoto(f);
      setPhotos((ps) => [...ps, p]);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!model || !A || !S.plotId) return;
    setBusy(true);
    const good = photos.filter((p) => p.result);
    const dx = aggregate(good.map((p) => p.result!), model.meta.tau);
    const now = new Date();
    const history = await allObservations();
    const trend = dx.kind === "confident"
      ? computeTrend({ plotId: S.plotId, block: q.block, stress: dx.stress, severity: dx.severity, takenAt: now.toISOString() }, history)
      : null;
    const ranking = rankCauses({ diagnosis: dx, trend: trend?.trend ?? null, sprayed: q.sprayed ?? "unknown", pack, now });
    const card = buildCard(dx, trend, ranking, A, L);
    const heatmaps = dx.kind === "confident"
      ? dx.agreeing.map((i) => heatmapFor(good[i], model.head, STRESS_CLASSES.indexOf(dx.stress), model.meta.features_shape)).filter((x): x is string => !!x)
      : [];
    const obs: Observation = {
      id: uuid(), plotId: S.plotId, block: q.block, takenAt: now.toISOString(),
      stress: dx.kind === "confident" ? dx.stress : "not_sure",
      severity: dx.kind === "confident" ? dx.severity : null,
      confidence: Math.round(dx.confidence * 1000) / 1000,
      reason: dx.kind === "not_sure" ? dx.reason : undefined,
      trend: trend?.trend ?? null,
      answers: { changed: q.changed ?? "nothing_new", sprayed: q.sprayed ?? "unknown" },
      modelVersion: model.meta.version, synced: false,
    };
    const sms = buildSms(card, q.block, now, A, L);
    setResult({ dx, trend, card, heatmaps, obs, sms, ms: good.map((p) => Math.round(p.result!.ms)) });
    setBusy(false);
    setScreen("card");
  }

  async function saveResult() {
    if (!result || saved) return;
    await addObservation(result.obs);
    await queue(result.obs);
    setQueued((await pending()).length);
    setSaved(true);
  }

  if (ready === "loading") return <div className="center"><div className="spinner" /><p>{t("en", "loading_model")}</p></div>;
  if (ready === "error") return <div className="center"><p className="bad">⚠️ {t(L, "model_error")}</p><pre className="small">{err}</pre></div>;
  const plot = plots.find((p) => p.plot_id === S.plotId) ?? null;

  return (
    <div className="app">
      <header>
        {screen !== "home" && <button className="ghost" onClick={() => setScreen("home")}>⬅ {tr("home")}</button>}
        <span className="brand">🌱 Jirani</span>
        <span className={`dot ${online ? "on" : "off"}`}>{online ? "📶 " + tr("status_online") : "✈️ " + tr("status_offline")}</span>
        <LangSwitch lang={L} set={(lang) => updateSettings({ lang })} />
      </header>

      {screen === "home" && (
        <main>
          <p className="tagline">{tr("tagline")}</p>
          {plot && <p className="small">🗺️ {tr("plot")}: <b>{plot.plot_id}</b></p>}
          <button className="big primary" onClick={startCheck}>🍃🍃🍃<br />{tr("check_leaves")}</button>
          <div className="row">
            <button className="big" onClick={() => setScreen("history")}>📒<br />{tr("history")}</button>
            <button className="big" onClick={() => setScreen("sync")}>📤<br />{tr("sync")}{queued > 0 && <span className="badge">{queued}</span>}</button>
            <button className="big" onClick={() => setScreen("settings")}>⚙️<br />{tr("settings")}</button>
          </div>
          {queued > 0 && <p className="small">📦 {tr("queued", { n: queued })}</p>}
          <p className={offlineReady ? "good" : "small"}>{offlineReady ? tr("offline_ready") : "⏳ " + tr("offline_preparing")}</p>
        </main>
      )}

      {screen === "setup" && (
        <Setup lang={L} plots={plots} settings={S} onSave={async (p) => { await updateSettings(p); setScreen("home"); }} />
      )}

      {screen === "capture" && (
        <Capture lang={L} photos={photos} busy={busy} onPhoto={addPhoto}
          onRetake={() => setPhotos((ps) => ps.slice(0, -1))}
          onContinue={() => setScreen("questions")} />
      )}

      {screen === "questions" && plot && (
        <Questions lang={L} blocks={plot.blocks} q={q} setQ={setQ} busy={busy} onDone={finish} />
      )}

      {screen === "card" && result && A && (
        <CardView lang={L} r={result} settings={S} pack={pack} saved={saved} onSave={saveResult}
          onDone={async () => { await saveResult(); setScreen("home"); }} />
      )}

      {screen === "history" && A && <History lang={L} A={A} plotId={S.plotId} />}
      {screen === "sync" && <Sync lang={L} online={online} settings={S} onChanged={async () => setQueued((await pending()).length)} />}
      {screen === "settings" && (
        <SettingsView lang={L} settings={S} plots={plots} update={updateSettings} model={model?.meta ?? null}
          onCleared={() => { setS(DEFAULT_SETTINGS); setQueued(0); setScreen("setup"); }} />
      )}
    </div>
  );
}

function LangSwitch({ lang, set }: { lang: Lang; set: (l: Lang) => void }) {
  return (
    <span className="lang">
      <button className={lang === "sw" ? "on" : ""} onClick={() => set("sw")}>SW</button>
      <button className={lang === "en" ? "on" : ""} onClick={() => set("en")}>EN</button>
    </span>
  );
}

function Setup({ lang, plots, settings, onSave }: { lang: Lang; plots: Plot[]; settings: Settings; onSave: (p: Partial<Settings>) => void }) {
  const [plotId, setPlotId] = useState(settings.plotId ?? "OND-0017");
  const [phone, setPhone] = useState(settings.phone);
  return (
    <main>
      <h2>🛠️ {t(lang, "setup_title")}</h2>
      <label>🗺️ {t(lang, "setup_plot")}
        <select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
          {plots.map((p) => <option key={p.plot_id} value={p.plot_id}>{p.plot_id} ({p.blocks.join(", ")})</option>)}
        </select>
      </label>
      <p className="small">{`SYNTHETIC demo registry`}</p>
      <label>📱 {t(lang, "setup_phone")}
        <input type="tel" inputMode="tel" value={phone} placeholder="+2547…" onChange={(e) => setPhone(e.target.value)} />
      </label>
      <p className="small">🔒 {t(lang, "setup_phone_hint")}</p>
      <button className="big primary" onClick={() => onSave({ plotId, phone, blocks: plots.find((p) => p.plot_id === plotId)?.blocks ?? [] })}>💾 {t(lang, "save")}</button>
    </main>
  );
}

const ISSUE_KEY: Record<string, string> = { blurry: "q_blurry", dark: "q_dark", bright: "q_bright", no_leaf: "q_no_leaf" };

function Capture({ lang, photos, busy, onPhoto, onRetake, onContinue }: {
  lang: Lang; photos: Photo[]; busy: boolean; onPhoto: (f: File | undefined) => void; onRetake: () => void; onContinue: () => void;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const n = photos.length;
  const last = photos[n - 1];
  const good = photos.filter((p) => p.quality.ok).length;
  return (
    <main>
      <div className="thumbs">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`thumb ${photos[i] ? (photos[i].quality.ok ? "ok" : "bad") : ""}`}>
            {photos[i] ? <img src={photos[i].thumbUrl} alt="" /> : <span>{i + 1}</span>}
            {photos[i] && <b>{photos[i].quality.ok ? "✅" : "❌"}</b>}
          </div>
        ))}
      </div>
      {last && !busy && (
        <p className={last.quality.ok ? "good" : "bad"}>
          {last.quality.ok ? "✅ " + t(lang, "q_ok") : `⚠️ ${t(lang, ISSUE_KEY[last.quality.issue!])} ${t(lang, "q_failed_note")}`}
        </p>
      )}
      {busy && <p><span className="spinner small-spin" /> {t(lang, "checking_photo")}</p>}
      {n < 3 && (
        <>
          <h2>🍃 {t(lang, "leaf_n", { n: n + 1 })}</h2>
          <div className="guide"><div className="leaf-outline" /></div>
          <p>{t(lang, "capture_guide")}</p>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={file} type="file" accept="image/*" hidden
            onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="big primary" disabled={busy} onClick={() => cam.current?.click()}>📷 {t(lang, "take_photo")}</button>
          <button className="big" disabled={busy} onClick={() => file.current?.click()}>🖼️ {t(lang, "pick_file")}</button>
        </>
      )}
      {n > 0 && !busy && <button className="ghost wide" onClick={onRetake}>🔁 {t(lang, "retake")}</button>}
      {n === 3 && !busy && (
        <>
          <p>{t(lang, "photos_good", { n: good })}</p>
          <button className="big primary" onClick={onContinue}>➡️ {t(lang, "continue")}</button>
        </>
      )}
    </main>
  );
}

function Choice<T extends string>({ options, value, set }: { options: { v: T; label: string; icon: string }[]; value: T | null | ""; set: (v: T) => void }) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button key={o.v} className={`choice ${value === o.v ? "on" : ""}`} onClick={() => set(o.v)}>{o.icon} {o.label}</button>
      ))}
    </div>
  );
}

function Questions({ lang, blocks, q, setQ, busy, onDone }: {
  lang: Lang; blocks: string[]; q: { block: string; changed: Changed | null; sprayed: Sprayed | null };
  setQ: (q: { block: string; changed: Changed | null; sprayed: Sprayed | null }) => void; busy: boolean; onDone: () => void;
}) {
  const T = (k: string) => t(lang, k);
  return (
    <main>
      <h3>🧭 {T("q_block")} <button className="ghost" onClick={() => playKeys(["prompt.block"])}>🔊 {T("play_prompt")}</button></h3>
      <Choice options={blocks.map((b) => ({ v: b, label: `${T("block")} ${b}`, icon: "🟩" }))} value={q.block} set={(block) => setQ({ ...q, block })} />
      <h3>🔄 {T("q_changed")} <button className="ghost" onClick={() => playKeys(["prompt.changed"])}>🔊 {T("play_prompt")}</button></h3>
      <Choice<Changed> options={[
        { v: "leaves_falling", label: T("changed_leaves_falling"), icon: "🍂" },
        { v: "spots_spreading", label: T("changed_spots_spreading"), icon: "🔴" },
        { v: "fewer_cherries", label: T("changed_fewer_cherries"), icon: "🍒" },
        { v: "nothing_new", label: T("changed_nothing_new"), icon: "➖" },
      ]} value={q.changed} set={(changed) => setQ({ ...q, changed })} />
      <h3>💦 {T("q_sprayed")} <button className="ghost" onClick={() => playKeys(["prompt.sprayed"])}>🔊 {T("play_prompt")}</button></h3>
      <Choice<Sprayed> options={[
        { v: "yes", label: T("yes"), icon: "✔️" }, { v: "no", label: T("no"), icon: "✖️" }, { v: "unknown", label: T("dont_know"), icon: "❔" },
      ]} value={q.sprayed} set={(sprayed) => setQ({ ...q, sprayed })} />
      <button className="big primary" disabled={!q.block || !q.changed || !q.sprayed || busy} onClick={onDone}>
        {busy ? <><span className="spinner small-spin" /> {T("analysing")}</> : <>➡️ {T("continue")}</>}
      </button>
    </main>
  );
}

function CardView({ lang, r, settings, pack, saved, onSave, onDone }: {
  lang: Lang; r: Result; settings: Settings; pack: ContextPack | null; saved: boolean; onSave: () => void; onDone: () => void;
}) {
  const c = r.card;
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const [audioMsg, setAudioMsg] = useState("");
  const packAge = pack ? Math.floor((Date.now() - Date.parse(pack.builtAt)) / 86_400_000) : null;
  return (
    <main className={`card ${c.confident ? "" : "unsure"}`}>
      <section className="slot hero">
        <div className="label">1 · {T("likely_stress")}</div>
        <div className="value">{ICON[c.stressKey]} {c.stress}</div>
        {c.reason && <div className="small">{c.reason}</div>}
      </section>
      <section className="slot">
        <div className="label">2 · {T("confidence")}</div>
        <div className={`conf ${c.confidenceLevel}`}>{c.confidenceLevel === "high" ? "●●●" : c.confidenceLevel === "medium" ? "●●○" : "○○○"} {c.confidenceLabel}
          {!(r.dx.kind === "not_sure" && r.dx.reason === "too_few_good_photos") && <span className="small"> ({Math.round(c.confidenceValue * 100)}%)</span>}</div>
      </section>
      <section className="slot">
        <div className="label">3 · {T("severity_trend")}</div>
        <div className="value2">{c.severity ? `📊 ${c.severity}. ` : ""}{c.trend}</div>
      </section>
      {r.heatmaps.length > 0 && (
        <section className="slot">
          <div className="heatmaps">{r.heatmaps.map((h, i) => <img key={i} src={h} alt="" />)}</div>
          <div className="small">🔥 {T("heatmap_caption")}</div>
        </section>
      )}
      <section className="slot do">
        <div className="label">4 · ✅ {T("action_week")}</div>
        <div>{c.action}</div>
      </section>
      <section className="slot dont">
        <div className="label">5 · 🚫 {T("do_not")}</div>
        <div>{c.doNot}</div>
      </section>
      <section className="slot">
        <div className="label">6 · 🔎 {T("causes")}</div>
        <ol className="causes">
          {c.causes.map((x, i) => (
            <li key={i} className={x.muted ? "muted" : ""}>{x.evidence}{x.confirm && <div className="small">↳ {T("to_confirm")} {x.confirm}</div>}</li>
          ))}
        </ol>
        {c.contextNote && <div className="small">⚠️ {c.contextNote}</div>}
        {!c.contextNote && packAge !== null && <div className="small">🛰️ {T("context_age", { days: packAge })}</div>}
      </section>
      <section className={`slot next ${c.nextStepKey}`}>
        <div className="label">7 · {T("next_step")}</div>
        <div className="value2">{c.nextStepKey === "sync" ? "📤" : "🧑‍🌾"} {c.nextStep}</div>
      </section>
      <p className="draft">📝 {c.draft}</p>

      <div className="actions">
        {settings.phone
          ? <a className="big primary btn" href={smsUri(settings.phone, r.sms)}>✉️ {T("send_sms")}</a>
          : <p className="small">{T("no_phone")}</p>}
        <details><summary className="small">{T("sms_preview")} ({r.sms.length}/160)</summary><code>{r.sms}</code></details>
        <button className="big" onClick={() => playKeys(cardClipKeys(c))}>🔊 {T("play_audio")}</button>
        <button className="ghost wide" onClick={async () => {
          const f = await cardAudioFile(cardClipKeys(c));
          if (f) setAudioMsg(await shareOrDownload(f));
        }}>📲 {T("share_audio")}</button>
        {audioMsg && <p className="small">{audioMsg}</p>}
        <button className="big" disabled={saved} onClick={onSave}>💾 {saved ? T("saved") : T("save")}</button>
        {saved && <p className="small good">{T("check_saved")}</p>}
        <button className="ghost wide" onClick={onDone}>🏠 {T("done")}</button>
      </div>
      {settings.showLatency && <p className="debug">⏱️ {T("latency", { ms: r.ms.join(" / ") || "-" })} · model {r.obs.modelVersion}</p>}
      <footer>{c.footer}</footer>
    </main>
  );
}

function History({ lang, A, plotId }: { lang: Lang; A: Answers; plotId: string | null }) {
  const [obs, setObs] = useState<Observation[] | null>(null);
  useEffect(() => { allObservations().then((o) => setObs(o.filter((x) => x.plotId === plotId).reverse())); }, [plotId]);
  if (!obs) return null;
  if (!obs.length) return <main><h2>📒 {t(lang, "history_title")}</h2><p>{t(lang, "no_history")}</p></main>;
  const blocks = [...new Set(obs.map((o) => o.block))].sort();
  return (
    <main>
      <h2>📒 {t(lang, "history_title")}</h2>
      {blocks.map((b) => {
        const list = obs.filter((o) => o.block === b);
        const strip = [...list].reverse();
        return (
          <section key={b} className="slot">
            <div className="label">🟩 {t(lang, "block")} {b} · {t(lang, "severity_strip")}</div>
            <div className="strip">
              {strip.map((o) => (
                <div key={o.id} className="bar" title={o.takenAt}>
                  <div className={`fill ${o.stress === "not_sure" ? "ns" : ""}`} style={{ height: `${o.severity === null ? 12 : 12 + o.severity * 22}%` }} />
                  <span>{ICON[o.stress]}</span>
                </div>
              ))}
            </div>
            <ul className="hist">
              {list.map((o) => (
                <li key={o.id}>
                  {o.demo && <span className="demo">{t(lang, "demo_label")}</span>}
                  {new Date(o.takenAt).toLocaleDateString()} · {ICON[o.stress]} {A.stress[o.stress][lang]}
                  {o.severity !== null && o.stress !== "healthy" ? ` · ${A.severity[String(o.severity)][lang]}` : ""}
                  {o.trend ? ` · ${A.sms.trend[o.trend][lang]}` : ""}
                  {o.synced ? " · 📤✓" : ""}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function Sync({ lang, online, settings, onChanged }: { lang: Lang; online: boolean; settings: Settings; onChanged: () => void }) {
  const [packets, setPackets] = useState<Packet[] | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const load = () => pending().then(setPackets);
  useEffect(() => { load(); }, []);
  return (
    <main>
      <h2>📤 {t(lang, "sync_title")}</h2>
      <p>🔒 {t(lang, "sync_explain")}</p>
      {packets && packets.length === 0 && <p>{t(lang, "sync_nothing")}</p>}
      {packets && packets.length > 0 && <pre className="packet">{JSON.stringify(packets, null, 2)}</pre>}
      <p className="small">🖥️ {t(lang, "sync_server")}: {settings.serverUrl}</p>
      {!online && <p className="bad">✈️ {t(lang, "sync_offline")}</p>}
      <button className="big primary" disabled={!online || sending || !packets?.length} onClick={async () => {
        setSending(true);
        const r = await send(settings.serverUrl);
        setSending(false);
        setMsg(r.ok ? t(lang, "sync_ok", { n: r.sent }) : `${t(lang, "sync_failed")} (${r.error})`);
        await load();
        onChanged();
      }}>{sending ? t(lang, "sync_sending") : `📤 ${t(lang, "sync_send")}`}</button>
      {msg && <p className={msg.includes("✓") ? "good" : "bad"}>{msg}</p>}
    </main>
  );
}

function SettingsView({ lang, settings, plots, update, model, onCleared }: {
  lang: Lang; settings: Settings; plots: Plot[]; update: (p: Partial<Settings>) => Promise<void>; model: ModelMeta | null; onCleared: () => void;
}) {
  const [msg, setMsg] = useState("");
  const T = (k: string) => t(lang, k);
  return (
    <main>
      <h2>⚙️ {T("settings_title")}</h2>
      <label>🌐 {T("language")}
        <select value={settings.lang} onChange={(e) => update({ lang: e.target.value as Lang })}>
          <option value="sw">{T("lang_sw")}</option><option value="en">{T("lang_en")}</option>
        </select>
      </label>
      <label>🗺️ {T("plot")}
        <select value={settings.plotId ?? ""} onChange={(e) => update({ plotId: e.target.value, blocks: plots.find((p) => p.plot_id === e.target.value)?.blocks ?? [] })}>
          {plots.map((p) => <option key={p.plot_id} value={p.plot_id}>{p.plot_id}</option>)}
        </select>
      </label>
      <label>📱 {T("phone")}
        <input type="tel" value={settings.phone} onChange={(e) => update({ phone: e.target.value })} />
      </label>
      <label>🖥️ {T("sync_server")}
        <input type="url" value={settings.serverUrl} onChange={(e) => update({ serverUrl: e.target.value })} />
      </label>
      <label className="check"><input type="checkbox" checked={settings.showLatency} onChange={(e) => update({ showLatency: e.target.checked })} /> ⏱️ {T("show_latency")}</label>
      <details>
        <summary className="small">🎬 Demo</summary>
        <button className="ghost wide" onClick={async () => {
          if (!settings.plotId) return;
          await addObservation({
            id: uuid(), plotId: settings.plotId, block: "B",
            takenAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
            stress: "rust", severity: 1, confidence: 0.9, trend: "first",
            answers: { changed: "nothing_new", sprayed: "no" }, modelVersion: model?.version ?? "demo", synced: true, demo: true,
          });
          setMsg(T("demo_added"));
        }}>{T("demo_mode")}</button>
      </details>
      <button className="big danger" onClick={async () => {
        if (!confirm(T("clear_confirm"))) return;
        await clearAll();
        setMsg(T("cleared"));
        onCleared();
      }}>🗑️ {T("clear_data")}</button>
      {msg && <p className="good">{msg}</p>}
      <p className="small">ℹ️ {T("review_note")}</p>
      {model && <p className="small">Model {model.version} · {(model.file_size_bytes / 1e6).toFixed(2)} MB · {model.variant} · tau {model.tau}</p>}
    </main>
  );
}

