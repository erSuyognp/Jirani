// The check flow: three leaf photos, then three tap-only questions.
import {
  ArrowRight, Camera, Check, CircleCheck, Images, Leaf, Minus, RotateCcw, TrendingDown, TriangleAlert, Volume2, X,
} from "lucide-react";
import { useRef } from "react";
import { playKeys } from "../handoff/audio";
import type { Photo } from "../inference/pipeline";
import type { Changed, Lang, Sprayed } from "../logic/types";
import { t } from "./i18n";
import type { CheckAnswers } from "./types";
import { Banner, Choice } from "./widgets";

const ISSUE_KEY: Record<string, string> = { blurry: "q_blurry", dark: "q_dark", bright: "q_bright", no_leaf: "q_no_leaf" };

export function Steps({ step }: { step: 1 | 2 | 3 }) {
  return <div className="steps" aria-hidden>{[1, 2, 3].map((i) => <i key={i} className={i < step ? "done" : i === step ? "on" : ""} />)}</div>;
}

export function Capture({ lang, photos, busy, onPhoto, onRetake, onContinue }: {
  lang: Lang; photos: Photo[]; busy: boolean; onPhoto: (f: File | undefined) => void; onRetake: () => void; onContinue: () => void;
}) {
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const n = photos.length;
  const last = photos[n - 1];
  const good = photos.filter((p) => p.quality.ok).length;
  return (
    <>
      <main className="screen">
        <Steps step={1} />
        <div className="thumbs">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`thumb ${photos[i] ? (photos[i].quality.ok ? "ok" : "bad") : i === n ? "next" : ""}`}>
              {photos[i] ? <img src={photos[i].thumbUrl} alt="" /> : <span>{i + 1}</span>}
              {photos[i] && <b>{photos[i].quality.ok ? <Check size={14} strokeWidth={3.5} /> : <X size={14} strokeWidth={3.5} />}</b>}
            </div>
          ))}
        </div>
        {busy && <Banner tone="info" icon={<span className="spinner small-spin" />}>{T("checking_photo")}</Banner>}
        {last && !busy && (last.quality.ok
          ? <Banner tone="ok" icon={<CircleCheck size={20} aria-hidden />}>{T("q_ok")}</Banner>
          : <Banner tone="bad" icon={<TriangleAlert size={20} aria-hidden />}>{T(ISSUE_KEY[last.quality.issue!])} {T("q_failed_note")}</Banner>)}
        {n < 3 && (
          <section className="card guide-card">
            <div className="guide" aria-hidden>
              <svg viewBox="0 0 200 100">
                <rect x="14" y="10" width="172" height="80" rx="6" className="paper" />
                <path d="M34 50 C 62 18, 128 18, 168 50 C 128 82, 62 82, 34 50 Z" className="leaf" />
                <path d="M34 50 H 168 M70 50 l14 -16 M70 50 l14 16 M100 50 l14 -18 M100 50 l14 18 M130 50 l12 -14 M130 50 l12 14" className="vein" />
              </svg>
            </div>
            <p>{T("capture_guide")}</p>
          </section>
        )}
        {n === 3 && !busy && <p className="center-note">{T("photos_good", { n: good })}</p>}
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={file} type="file" accept="image/*" hidden
          onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      </main>
      <div className="actionbar">
        {n < 3
          ? <>
              <button className="btn primary" disabled={busy} onClick={() => cam.current?.click()}>
                <Camera size={22} aria-hidden /> {T("take_photo")} · {T("leaf_n", { n: n + 1 })}
              </button>
              <div className="split">
                <button className="btn secondary" disabled={busy} onClick={() => file.current?.click()}><Images size={20} aria-hidden /> {T("pick_file")}</button>
                {n > 0 && <button className="btn secondary" disabled={busy} onClick={onRetake}><RotateCcw size={20} aria-hidden /> {T("retake")}</button>}
              </div>
            </>
          : <>
              <button className="btn primary" disabled={busy} onClick={onContinue}>{T("continue")} <ArrowRight size={20} aria-hidden /></button>
              <button className="btn secondary" disabled={busy} onClick={onRetake}><RotateCcw size={20} aria-hidden /> {T("retake")}</button>
            </>}
      </div>
    </>
  );
}

export function Questions({ lang, blocks, q, setQ, busy, onDone }: {
  lang: Lang; blocks: string[]; q: CheckAnswers; setQ: (q: CheckAnswers) => void; busy: boolean; onDone: () => void;
}) {
  const T = (k: string) => t(lang, k);
  const listen = (key: string) => (
    <button className="listen" aria-label={T("play_prompt")} onClick={() => playKeys([key])}><Volume2 size={20} aria-hidden /></button>
  );
  return (
    <>
      <main className="screen">
        <Steps step={2} />
        <section className="card question">
          <h3>{T("q_block")} {listen("prompt.block")}</h3>
          <Choice options={blocks.map((b) => ({ v: b, label: `${T("block")} ${b}` }))} value={q.block} set={(block) => setQ({ ...q, block })} />
        </section>
        <section className="card question">
          <h3>{T("q_changed")} {listen("prompt.changed")}</h3>
          <Choice<Changed> options={[
            { v: "leaves_falling", label: T("changed_leaves_falling"), icon: <Leaf size={18} aria-hidden /> },
            { v: "spots_spreading", label: T("changed_spots_spreading"), icon: <TriangleAlert size={18} aria-hidden /> },
            { v: "fewer_cherries", label: T("changed_fewer_cherries"), icon: <TrendingDown size={18} aria-hidden /> },
            { v: "nothing_new", label: T("changed_nothing_new"), icon: <Minus size={18} aria-hidden /> },
          ]} value={q.changed} set={(changed) => setQ({ ...q, changed })} />
        </section>
        <section className="card question">
          <h3>{T("q_sprayed")} {listen("prompt.sprayed")}</h3>
          <Choice<Sprayed> options={[
            { v: "yes", label: T("yes") }, { v: "no", label: T("no") }, { v: "unknown", label: T("dont_know") },
          ]} value={q.sprayed} set={(sprayed) => setQ({ ...q, sprayed })} />
        </section>
      </main>
      <div className="actionbar">
        <button className="btn primary" disabled={!q.block || !q.changed || !q.sprayed || busy} onClick={onDone}>
          {busy ? <><span className="spinner small-spin light" /> {T("analysing")}</> : <>{T("see_result")} <ArrowRight size={20} aria-hidden /></>}
        </button>
      </div>
    </>
  );
}
