// The check flow: three leaf photos on the printed card, an optional cherry photo, then three tap-only questions.
import {
  ArrowRight, Camera, Check, Cherry, CircleCheck, Images, Info, Leaf, Minus, RotateCcw, TrendingDown, TriangleAlert, Volume2, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { playKeys } from "../handoff/audio";
import { gikuyuPack, playGikuyu } from "../handoff/gikuyu";
import type { CherryPhoto, Photo } from "../inference/pipeline";
import type { Changed, Lang, Sprayed } from "../logic/types";
import { CardLink } from "./CardLink";
import { t } from "./i18n";
import type { CheckAnswers } from "./types";
import { Banner, Choice } from "./widgets";

const ISSUE_KEY: Record<string, string> = { blurry: "q_blurry", dark: "q_dark", bright: "q_bright", no_leaf: "q_no_leaf" };

export function Steps({ step }: { step: 1 | 2 | 3 }) {
  return <div className="steps" aria-hidden>{[1, 2, 3].map((i) => <i key={i} className={i < step ? "done" : i === step ? "on" : ""} />)}</div>;
}

/** The printed capture card (public/capture-card.pdf): three leaf boxes, one cherry box, corner marks, scale bar. */
function CardDiagram({ box }: { box: number | "cherry" }) {
  const mark = (x: number, y: number) => (
    <g>
      <rect x={x} y={y} width="14" height="14" className="mark" />
      <rect x={x + 2.5} y={y + 2.5} width="9" height="9" className="mark-in" />
      <rect x={x + 4.5} y={y + 4.5} width="5" height="5" className="mark" />
    </g>
  );
  return (
    <svg viewBox="0 0 150 212">
      <rect x="1" y="1" width="148" height="210" rx="3" className="paper" />
      {mark(7, 7)}{mark(129, 7)}{mark(7, 191)}
      {[0, 1, 2].map((i) => (
        <g key={i} className={box === i ? "box on" : "box"}>
          <rect x="14" y={26 + i * 46} width="122" height="41" rx="2" />
          <path d={`M30 ${46.5 + i * 46} C 50 ${30 + i * 46}, 96 ${30 + i * 46}, 122 ${46.5 + i * 46} C 96 ${63 + i * 46}, 50 ${63 + i * 46}, 30 ${46.5 + i * 46} Z`} className="leaf" />
          <text x="20" y={36 + i * 46}>{i + 1}</text>
        </g>
      ))}
      <g className={box === "cherry" ? "box on" : "box"}>
        <rect x="54" y="165" width="82" height="40" rx="2" />
        {[[80, 182], [92, 178], [88, 190], [101, 187], [106, 177]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="5" className="cherry" />)}
      </g>
      <path d="M26 176 h14 M26 173 v6 M40 173 v6" className="scale" />
    </svg>
  );
}

export function Capture({ lang, photos, cherry, busy, onPhoto, onRetake, onCherry, onCherryRemove, onContinue }: {
  lang: Lang; photos: Photo[]; cherry: CherryPhoto | null; busy: boolean; onPhoto: (f: File | undefined) => void; onRetake: () => void;
  onCherry: (f: File | undefined) => void; onCherryRemove: () => void; onContinue: () => void;
}) {
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const cherryCam = useRef<HTMLInputElement>(null);
  const cherryFile = useRef<HTMLInputElement>(null);
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
            <div className="guide" aria-hidden><CardDiagram box={n} /></div>
            <p>{T("capture_guide")}</p>
            <CardLink lang={lang} />
          </section>
        )}
        {n === 3 && !busy && <p className="center-note">{T("photos_good", { n: good })}</p>}
        {n === 3 && (
          <section className="card cherry-card">
            <div className="label"><Cherry size={16} aria-hidden /> {T("cherry_title")} <em>{T("optional")}</em></div>
            {cherry
              ? <div className="cherry-row">
                  <img src={cherry.thumbUrl} alt="" />
                  <div>
                    <b className={cherry.grade.band ? "ok" : "bad"}>{T(cherry.grade.band ? "cherry_added" : `cherry_${cherry.grade.issue}`)}</b>
                    <button className="btn text" disabled={busy} onClick={onCherryRemove}><X size={18} aria-hidden /> {T("cherry_remove")}</button>
                  </div>
                </div>
              : <>
                  <div className="cherry-guide">
                    <div className="guide small" aria-hidden><CardDiagram box="cherry" /></div>
                    <p>{T("cherry_guide")}</p>
                  </div>
                  <div className="split">
                    <button className="btn secondary" disabled={busy} onClick={() => cherryCam.current?.click()}><Camera size={20} aria-hidden /> {T("take_photo")}</button>
                    <button className="btn secondary" disabled={busy} onClick={() => cherryFile.current?.click()}><Images size={20} aria-hidden /> {T("pick_file")}</button>
                  </div>
                  <p className="hint"><Info size={15} aria-hidden /> {T("cherry_skip_note")}</p>
                </>}
          </section>
        )}
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={file} type="file" accept="image/*" hidden
          onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={cherryCam} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { onCherry(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={cherryFile} type="file" accept="image/*" hidden
          onChange={(e) => { onCherry(e.target.files?.[0]); e.target.value = ""; }} />
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

type Prompt = "block" | "changed" | "sprayed";
const SPRAYED_CONFIRM: Record<Sprayed, string> = { yes: "confirm.yes", no: "confirm.no", unknown: "confirm.not_sure" };

export function Questions({ lang, blocks, q, setQ, busy, onDone }: {
  lang: Lang; blocks: string[]; q: CheckAnswers; setQ: (q: CheckAnswers) => void; busy: boolean; onDone: () => void;
}) {
  const T = (k: string) => t(lang, k);
  const [placeholder, setPlaceholder] = useState(false);
  const [asked, setAsked] = useState<Partial<Record<Prompt, boolean>>>({}); // questions whose Gikuyu prompt was pressed
  useEffect(() => { gikuyuPack().then((p) => setPlaceholder(p.placeholder)); }, []);

  const listen = (key: string) => (
    <button className="listen" aria-label={T("play_prompt")} onClick={() => playKeys([key])}><Volume2 size={20} aria-hidden /></button>
  );
  /** "Play prompt": speaks the question from the recorded Gikuyu clip (if there is one), then shows it in Kiswahili. */
  const prompt = (p: Prompt) => (
    <div className="ki">
      <button className="ki-play" onClick={async () => { await playGikuyu(`prompt.${p}`); setAsked((a) => ({ ...a, [p]: true })); }}>
        <Volume2 size={17} aria-hidden /> {T("ki_play")}
      </button>
      {asked[p] && <p className="ki-sw" lang="sw">{T("ki_in_sw")} {t("sw", `q_${p}`)}</p>}
    </div>
  );
  return (
    <>
      <main className="screen">
        <Steps step={2} />
        {placeholder && <Banner tone="warn" icon={<Info size={18} aria-hidden />}>{T("ki_placeholder")}</Banner>}
        <section className="card question">
          <h3>{T("q_block")} {listen("prompt.block")}</h3>
          {prompt("block")}
          <Choice options={blocks.map((b) => ({ v: b, label: `${T("block")} ${b}` }))} value={q.block}
            set={(block) => { setQ({ ...q, block }); if (asked.block) playGikuyu(`confirm.${block.toLowerCase()}_block`); }} />
        </section>
        <section className="card question">
          <h3>{T("q_changed")} {listen("prompt.changed")}</h3>
          {prompt("changed")}
          <Choice<Changed> options={[
            { v: "leaves_falling", label: T("changed_leaves_falling"), icon: <Leaf size={18} aria-hidden /> },
            { v: "spots_spreading", label: T("changed_spots_spreading"), icon: <TriangleAlert size={18} aria-hidden /> },
            { v: "fewer_cherries", label: T("changed_fewer_cherries"), icon: <TrendingDown size={18} aria-hidden /> },
            { v: "nothing_new", label: T("changed_nothing_new"), icon: <Minus size={18} aria-hidden /> },
          ]} value={q.changed} set={(changed) => setQ({ ...q, changed })} />
        </section>
        <section className="card question">
          <h3>{T("q_sprayed")} {listen("prompt.sprayed")}</h3>
          {prompt("sprayed")}
          <Choice<Sprayed> options={[
            { v: "yes", label: T("yes") }, { v: "no", label: T("no") }, { v: "unknown", label: T("dont_know") },
          ]} value={q.sprayed} set={(sprayed) => { setQ({ ...q, sprayed }); if (asked.sprayed) playGikuyu(SPRAYED_CONFIRM[sprayed]); }} />
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
