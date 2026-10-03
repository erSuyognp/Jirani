// Sync: shows exactly what will be sent. Nothing leaves the phone until Send is pressed.
import { CircleCheck, Lock, Send, Server, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Packet, Settings } from "../db/db";
import type { Answers } from "../logic/answers";
import type { Lang } from "../logic/types";
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
  const load = () => pending().then(setPackets);
  useEffect(() => { load(); }, []);

  async function sendAll() {
    setSending(true);
    setError("");
    const r = await send(settings.serverUrl);
    setSending(false);
    if (r.ok) notify(T("sync_ok", { n: r.sent }), "ok");
    else setError(r.error ?? "");
    await load();
    onChanged();
  }

  const n = packets?.length ?? 0;
  return (
    <>
      <main className="screen">
        <h2 className="page-title">{T("sync_title")}</h2>
        <Banner tone="info" icon={<Lock size={20} aria-hidden />}>{T("sync_explain")}</Banner>
        {packets && n === 0 && (
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
        {!online && <Banner tone="warn" icon={<WifiOff size={20} aria-hidden />}>{T("sync_offline")}</Banner>}
        {error && <Banner tone="bad" icon={<WifiOff size={20} aria-hidden />}>{T("sync_failed")}<small>{error}</small></Banner>}
        <p className="hint"><Server size={15} aria-hidden /> {T("sync_server")}: {settings.serverUrl.replace(/^https?:\/\//, "")}</p>
      </main>
      {n > 0 && (
        <div className="actionbar above-nav">
          <button className="btn primary" disabled={!online || sending} onClick={sendAll}>
            {sending ? <><span className="spinner small-spin light" /> {T("sync_sending")}</> : <><Send size={20} aria-hidden /> {T("sync_send")} ({n})</>}
          </button>
        </div>
      )}
    </>
  );
}
