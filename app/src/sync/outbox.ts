// Store-and-forward. Packets wait in IndexedDB until the user opens Sync and presses Send.
// Packet carries no name, phone number, photo or device location: plot id + class only.
// Leaf photos go separately, and only for checks where the farmer chose "Ask the officer".
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { allAsks, allObservations, enqueue, getVisits, markSynced, outbox, type Packet, putAsk, saveVisits } from "../db/db";
import type { Ask, Observation, OfficerReply, Visit } from "../logic/types";

export function packetFor(o: Observation): Packet {
  return {
    id: o.id,
    plotId: o.plotId,
    block: o.block,
    stress: o.stress,
    severity: o.severity,
    trend: o.trend ?? null,
    confidence: Math.round(o.confidence * 1000) / 1000,
    takenAt: o.takenAt,
    modelVersion: o.modelVersion,
  };
}

export async function queue(o: Observation) {
  if (o.demo) return; // demo data never leaves the phone
  await enqueue(packetFor(o));
}

export async function pending(): Promise<Packet[]> {
  return (await outbox()).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

// Android app: native HTTP, so the server's CORS list does not need the WebView origin.
async function http(method: "GET" | "POST", url: string, data?: unknown): Promise<{ status: number; data: unknown }> {
  const headers = { "Content-Type": "application/json" };
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ method, url, headers, data });
    return { status: r.status, data: r.data };
  }
  const r = await fetch(url, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const ok = (status: number) => status >= 200 && status < 300;

export interface SendResult { ok: boolean; sent: number; photos: number; replies: number; visits: boolean; error?: string }

/** Photos of one check. If the server no longer has the report (free hosts wipe their disk), send it again first. */
async function sendAsk(base: string, a: Ask): Promise<number> {
  const body = { id: a.id, plotId: a.plotId, block: a.block, images: a.images };
  let r = await http("POST", `${base}/api/consults`, body);
  if (r.status === 422) {
    const o = (await allObservations()).find((x) => x.id === a.id);
    if (o && ok((await http("POST", `${base}/api/reports`, packetFor(o))).status)) r = await http("POST", `${base}/api/consults`, body);
  }
  return r.status;
}

/**
 * Only called from the Send button. On failure everything stays queued (idempotent by id on the server).
 * Order: reports, then the photos of checks where the farmer asked the officer, then any officer replies,
 * then the officer visits planned for this plot.
 * A photo request that fails stays queued and does not hold back the others or the replies.
 */
export async function send(serverUrl: string, plotId: string | null): Promise<SendResult> {
  const base = serverUrl.replace(/\/$/, "");
  const out: SendResult = { ok: true, sent: 0, photos: 0, replies: 0, visits: false };
  try {
    const packets = await pending();
    if (packets.length) {
      const r = await http("POST", `${base}/api/reports`, packets);
      if (!ok(r.status)) return { ...out, ok: false, error: `HTTP ${r.status}` };
      await markSynced(packets.map((p) => p.id));
      out.sent = packets.length;
    }
    const asks = await allAsks();
    for (const a of asks.filter((x) => x.status === "queued")) {
      const status = await sendAsk(base, a);
      if (!ok(status)) {
        out.ok = false;
        out.error = `HTTP ${status}`;
        continue;
      }
      a.status = "sent";
      await putAsk(a);
      out.photos++;
    }
    const waiting = asks.filter((x) => x.status === "sent");
    if (waiting.length) {
      const r = await http("GET", `${base}/api/consults/replies?ids=${waiting.map((a) => encodeURIComponent(a.id)).join(",")}`);
      const data = ok(r.status) ? (r.data as { replies?: (OfficerReply & { id: string })[]; unknown?: string[] } | null) : null;
      // the server lost these requests (wiped disk): queue them again for the next Send
      for (const a of waiting.filter((x) => data?.unknown?.includes(x.id))) await putAsk({ ...a, status: "queued" });
      for (const { id, ...reply } of data?.replies ?? []) {
        const a = waiting.find((x) => x.id === id);
        if (!a) continue;
        await putAsk({ ...a, status: "answered", reply, seen: false });
        out.replies++;
      }
    }
    if (plotId) {
      const r = await http("GET", `${base}/api/visits?plotId=${encodeURIComponent(plotId)}`);
      if (ok(r.status)) {
        const visits = (r.data as { visits?: Visit[] } | null)?.visits ?? [];
        out.visits = visits.length > 0 && JSON.stringify(visits) !== JSON.stringify(await getVisits());
        await saveVisits(visits);
      }
    }
    return out;
  } catch (e) {
    return { ...out, ok: false, error: String(e) };
  }
}

/** Photos the farmer chose to send, still waiting on this phone. */
export async function queuedAsks(): Promise<Ask[]> {
  return (await allAsks()).filter((a) => a.status === "queued").sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}
