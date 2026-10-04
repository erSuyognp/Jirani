// Sync: shows exactly what will be sent. Nothing leaves the phone until Send is pressed.
import { CircleCheck, Clock, Lock, RefreshCw, Send, Server, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { allAsks, type Packet, type Settings } from "../db/db";
import type { Answers } from "../logic/answers";
import type { Ask, Lang } from "../logic/types";
import { askBytes } from "../sync/ask";
import { pending, send } from "../sync/outbox";
import { t } from "./i18n";
import { Banner, fmtDate, StressBadge } from "./widgets";

export function Sync({ lang, A, online, settings, onChanged, notify }: {
  lang: Lang; A: Answers; online: boolean; settings: Settings; onChanged: () => void; notify: (text: string, tone?: "ok" | "bad") => void;
}) {
  const T = (k: string, v?: Record<string, string | number>) => t(lang, k, v);
  const [packets, setPackets] = useState<Packet[] | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [asks, setAsks] = useState<Ask[]>([]);
  const load = async () => {
    setAsks(await allAsks());
    setPackets(await pending());
  };
  useEffect(() => { load(); }, []);
  const queuedAsks = asks.filter((a) => a.status === "queued");
  const waiting = asks.filter((a) => a.status === "sent").length;

  async function sendAll() {
    setSending(true);
    setError("");
    const r = await send(settings.serverUrl, settings.plotId);
    setSending(false);
    const done = [
      r.sent > 0 && T("sync_ok", { n: r.sent }),
      r.photos > 0 && T("ask_sent", { n: r.photos }),
      r.replies > 0 && T("ask_replies", { n: r.replies }),
      r.visits && T("visit_news"),
    ].filter(Boolean).join(" · ");
    if (done) notify(done, "ok");
    else if (r.ok) notify(T("ask_no_reply"));
    if (!r.ok) setError(r.error ?? "");
    await load();
    onChanged();
  }

  const n = packets?.length ?? 0;
  return (
    <>
      <main className="screen">
        <h2 className="page-title">{T("sync_title")}</h2>
        <Banner tone="info" icon={<Lock size={20} aria-hidden />}>{T("sync_explain")}</Banner>
        {packets && n === 0 && queuedAsks.length === 0 && waiting === 0 && (
          <div className="empty">
            <span className="ok"><CircleCheck size={36} aria-hidden /></span>
            <p>{T("sync_nothing")}</p>
          </div>
        )}
        {packets && n > 0 && (
          <>
            <h3 className="section-title">{T("queued", { n })}</h3>
            <ul className="card list">
              {packets.map((p) => (
                <li key={p.id} className="row">
                  <StressBadge stress={p.stress} size={36} />
                  <span className="row-main">
                    <b>{A.stress[p.stress]?.[lang] ?? p.stress}</b>
                    <span className="row-sub">{p.plotId} · {T("block")} {p.block}{p.severity !== null && p.stress !== "healthy" ? ` · ${A.severity[String(p.severity)][lang]}` : ""}</span>
                  </span>
                  <span className="row-end">{fmtDate(p.takenAt, lang)}</span>
                </li>
              ))}
            </ul>
            <details className="card" open>
              <summary>{T("sync_exact")}</summary>
              <pre className="packet">{JSON.stringify(packets, null, 2)}</pre>
            </details>
          </>
        )}
        {queuedAsks.length > 0 && (
          <>
            <h3 className="section-title">{T("ask_queue_title")}</h3>
            <ul className="card list">
              {queuedAsks.map((a) => (
                <li key={a.id} className="row">
                  <span className="row-main">
                    <b>{T("block")} {a.block} · {fmtDate(a.takenAt, lang)}</b>
                    <span className="row-sub">{T("ask_photos_n", { n: a.images.length, kb: Math.round(askBytes(a.images) / 1024) })}</span>
                    <span className="ask-thumbs small">{a.images.map((im, i) => <img key={i} src={`data:image/jpeg;base64,${im}`} alt="" />)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {waiting > 0 && <Banner tone="info" icon={<Clock size={20} aria-hidden />}>{T("ask_waiting", { n: waiting })}</Banner>}
        {!online && <Banner tone="warn" icon={<WifiOff size={20} aria-hidden />}>{T("sync_offline")}</Banner>}
        {error && <Banner tone="bad" icon={<WifiOff size={20} aria-hidden />}>{T("sync_failed")}<small>{error}</small></Banner>}
        <p className="hint"><Server size={15} aria-hidden /> {T("sync_server")}: {settings.serverUrl.replace(/^https?:\/\//, "")}</p>
      </main>
      <div className="actionbar above-nav">
        <button className={`btn ${n > 0 || queuedAsks.length > 0 ? "primary" : "secondary"}`} disabled={!online || sending} onClick={sendAll}>
          {sending ? <><span className={`spinner small-spin ${n > 0 || queuedAsks.length > 0 ? "light" : ""}`} /> {T("sync_sending")}</>
            : n > 0 || queuedAsks.length > 0 ? <><Send size={20} aria-hidden /> {T("sync_send")} ({n || queuedAsks.length})</>
            : <><RefreshCw size={20} aria-hidden /> {T("ask_check_replies")}</>}
        </button>
      </div>
    </>
  );
}
