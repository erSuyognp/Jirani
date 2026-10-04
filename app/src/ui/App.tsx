import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { STRESS_CLASSES } from "../config";
import { addObservation, allAsks, allObservations, DEFAULT_SETTINGS, getSettings, putAsk, saveSettings, type Settings } from "../db/db";
import { buildSms } from "../handoff/sms";
import { loadModel, type ModelMeta, type StressHead } from "../inference/model";
import { heatmapFor, type Photo, processPhoto } from "../inference/pipeline";
import { aggregate } from "../logic/aggregate";
import type { Answers } from "../logic/answers";
import { buildCard } from "../logic/card";
import { rankCauses } from "../logic/causes";
import { computeTrend } from "../logic/trend";
import type { Ask, ContextPack, Lang, Observation } from "../logic/types";
import { askImages } from "../sync/ask";
import { pending, queue, queuedAsks } from "../sync/outbox";
import { Capture, Questions } from "./Check";
import { History } from "./History";
import { Home } from "./Home";
import { loadStrings, t } from "./i18n";
import { buzz, isNative, leaveApp, onBackButton, styleSystemBars, tap } from "./native";
import { Setup, Welcome } from "./Onboarding";
import { ResultCard } from "./Result";
import { SettingsView } from "./Settings";
import { Sync } from "./Sync";
import type { CheckAnswers, Plot, Result } from "./types";
import { AppBar, BottomNav, Dialog, type DialogSpec, Logo, type Tab, Toast, type ToastSpec } from "./widgets";

const BASE = import.meta.env.BASE_URL;
type Screen = Tab | "welcome" | "setup" | "capture" | "questions" | "card";
const TABS: readonly Screen[] = ["home", "history", "sync", "settings"];
const TITLE: Partial<Record<Screen, string>> = {
  setup: "setup_title", history: "history", sync: "sync", settings: "settings",
  capture: "step_photos", questions: "questions_title", card: "card_title",
};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

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
  const [obs, setObs] = useState<Observation[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<CheckAnswers>({ block: "", changed: null, sprayed: null });
  const [result, setResult] = useState<Result | null>(null);
  const [ask, setAsk] = useState(false); // "Ask the officer": send this check's leaf photos (opt-in)
  const [asks, setAsks] = useState<Ask[]>([]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const L: Lang = S.lang;
  const tr = (k: string, v?: Record<string, string | number>) => t(L, k, v);
  const notify = (text: string, tone?: "ok" | "bad") => setToast({ text, tone, id: Date.now() });

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
        await refreshQueued();
        if (!s.plotId) setScreen("welcome");
        setReady("ok");
        styleSystemBars();
      } catch (e) {
        setErr(String(e));
        setReady("error");
      }
    })();
    // Android app: everything ships inside the APK, so it is offline-ready from the start and needs no service worker.
    if (isNative) {
      setOfflineReady(true);
      return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }
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

  useEffect(() => {
    if (ready !== "ok" || (screen !== "home" && screen !== "history")) return;
    allObservations().then(setObs);
    allAsks().then((all) => {
      setAsks(all);
      // opening History marks officer replies as read (this visit still shows them as new)
      if (screen === "history") all.filter((a) => a.reply && !a.seen).forEach((a) => putAsk({ ...a, seen: true }));
    });
  }, [ready, screen]);

  /** Sync badge: reports waiting, or photo requests waiting when their reports already went. */
  async function refreshQueued() {
    setQueued((await pending()).length || (await queuedAsks()).length);
  }

  useEffect(() => { document.documentElement.lang = L; }, [L]);

  async function updateSettings(p: Partial<Settings>) {
    const n = { ...S, ...p };
    setS(n);
    await saveSettings(n);
  }

  function startCheck() {
    tap();
    setPhotos([]);
    setResult(null);
    setAsk(false);
    setQ({ block: "", changed: null, sprayed: null });
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
      buzz(p.quality.ok ? "ok" : "bad");
      setPhotos((ps) => [...ps, p]);
    } catch {
      notify(tr("photo_error"), "bad");
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
    const heatmaps = dx.kind === "confident"
      ? dx.agreeing.map((i) => heatmapFor(good[i], model.head, STRESS_CLASSES.indexOf(dx.stress), model.meta.features_shape)).filter((x): x is string => !!x)
      : [];
    const o: Observation = {
      id: uuid(), plotId: S.plotId, block: q.block, takenAt: now.toISOString(),
      stress: dx.kind === "confident" ? dx.stress : "not_sure",
      severity: dx.kind === "confident" ? dx.severity : null,
      confidence: Math.round(dx.confidence * 1000) / 1000,
      reason: dx.kind === "not_sure" ? dx.reason : undefined,
      trend: trend?.trend ?? null,
      answers: { changed: q.changed ?? "nothing_new", sprayed: q.sprayed ?? "unknown" },
      modelVersion: model.meta.version, synced: false,
    };
    setResult({ dx, trend, ranking, heatmaps, obs: o, at: now, ms: good.map((p) => Math.round(p.result!.ms)) });
    setBusy(false);
    setScreen("card");
  }

  // The card and the SMS are looked up again when the language changes.
  const card = useMemo(() => (result && A ? buildCard(result.dx, result.trend, result.ranking, A, L) : null), [result, A, L]);
  const sms = useMemo(() => (result && card && A ? buildSms(card, result.obs.block, result.at, A, L) : ""), [result, card, A, L]);

  async function saveAndFinish() {
    if (!result) return;
    await addObservation(result.obs);
    await queue(result.obs);
    if (ask) {
      const { id, plotId, block, takenAt } = result.obs;
      await putAsk({ id, plotId, block, takenAt, images: await askImages(photos), status: "queued" });
    }
    await refreshQueued();
    setResult(null);
    setScreen("home");
    notify(tr(ask ? "ask_saved" : "check_saved"), "ok");
  }

  function goBack() {
    if (dialog) return setDialog(null);
    if (busy) return;
    switch (screen) {
      case "welcome": case "home": return leaveApp();
      case "setup": return setScreen("welcome");
      case "capture":
        if (!photos.length) return setScreen("home");
        return setDialog({
          title: tr("discard_title"), body: tr("discard_body"), confirm: tr("discard_yes"), cancel: tr("keep_going"), danger: true,
          onConfirm: () => setScreen("home"),
        });
      case "questions": return setScreen("capture");
      case "card":
        return setDialog({
          title: tr("leave_title"), body: tr("leave_body"), confirm: tr("save_finish"), cancel: tr("dont_save"),
          onConfirm: saveAndFinish, onCancel: () => { setResult(null); setScreen("home"); },
        });
      default: return setScreen("home");
    }
  }
  const back = useRef(goBack);
  back.current = goBack;
  useEffect(() => onBackButton(() => back.current()), []);

  if (ready === "loading") return <div className="splash"><Logo size={72} /><b>Jirani</b><div className="spinner light" /></div>;
  if (ready === "error") {
    return (
      <div className="center">
        <span className="error-icon"><TriangleAlert size={36} /></span>
        <p>{t(L, "model_error")}</p>
        <pre className="small">{err}</pre>
        <button className="btn primary" onClick={() => window.location.reload()}><RotateCcw size={20} /> {t(L, "retry")}</button>
      </div>
    );
  }
  const plot = plots.find((p) => p.plot_id === S.plotId) ?? null;
  const isTab = TABS.includes(screen);
  const flow = !isTab && screen !== "welcome";

  return (
    <div className="app">
      <AppBar lang={L} setLang={(lang) => updateSettings({ lang })}
        title={TITLE[screen] ? tr(TITLE[screen]!) : undefined}
        onBack={flow ? goBack : undefined}
        online={isTab ? online : undefined} />

      {screen === "welcome" && <Welcome lang={L} onStart={() => setScreen("setup")} />}
      {screen === "setup" && (
        <Setup lang={L} plots={plots} settings={S} onSave={async (p) => { await updateSettings(p); setScreen("home"); }} />
      )}

      {screen === "home" && A && (
        <Home lang={L} plot={plot} obs={obs} A={A} queued={queued} replies={asks.filter((a) => a.reply && !a.seen).length}
          offlineReady={offlineReady} onCheck={startCheck} go={setScreen} />
      )}
      {screen === "capture" && (
        <Capture lang={L} photos={photos} busy={busy} onPhoto={addPhoto}
          onRetake={() => setPhotos((ps) => ps.slice(0, -1))}
          onContinue={() => setScreen("questions")} />
      )}
      {screen === "questions" && plot && (
        <Questions lang={L} blocks={plot.blocks} q={q} setQ={setQ} busy={busy} onDone={finish} />
      )}
      {screen === "card" && result && card && (
        <ResultCard lang={L} r={result} card={card} sms={sms} settings={S} pack={pack} photos={photos} ask={ask} setAsk={setAsk}
          onSave={saveAndFinish} notify={notify} />
      )}

      {screen === "history" && A && <History lang={L} A={A} obs={obs} asks={asks} phone={S.phone} plotId={S.plotId} onCheck={startCheck} />}
      {screen === "sync" && A && (
        <Sync lang={L} A={A} online={online} settings={S} notify={notify} onChanged={refreshQueued} />
      )}
      {screen === "settings" && (
        <SettingsView lang={L} settings={S} plots={plots} update={updateSettings} model={model?.meta ?? null} ask={setDialog} notify={notify}
          onCleared={() => { setS(DEFAULT_SETTINGS); setQueued(0); setObs([]); setScreen("welcome"); }} />
      )}

      {isTab && <BottomNav lang={L} tab={screen as Tab} go={(s) => { tap(); setScreen(s); }} queued={queued} />}
      {toast && <Toast toast={toast} clear={() => setToast(null)} />}
      {dialog && <Dialog spec={dialog} close={() => setDialog(null)} />}
    </div>
  );
}
