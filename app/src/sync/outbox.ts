// Store-and-forward. Packets wait in IndexedDB until the user opens Sync and presses Send.
// Packet carries no name, phone number, photo or device location: plot id + class only.
// Leaf photos go separately, and only for checks where the farmer chose "Ask the officer".
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { allAsks, enqueue, markSynced, outbox, type Packet, putAsk } from "../db/db";
import type { Ask, Observation, OfficerReply } from "../logic/types";

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

export interface SendResult { ok: boolean; sent: number; photos: number; replies: number; error?: string }

/**
 * Only called from the Send button. On failure everything stays queued (idempotent by id on the server).
 * Order: reports, then the photos of checks where the farmer asked the officer, then any officer replies.
 */
export async function send(serverUrl: string): Promise<SendResult> {
  const base = serverUrl.replace(/\/$/, "");
  const out: SendResult = { ok: true, sent: 0, photos: 0, replies: 0 };
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
      const r = await http("POST", `${base}/api/consults`, { id: a.id, plotId: a.plotId, block: a.block, images: a.images });
      if (!ok(r.status)) return { ...out, ok: false, error: `HTTP ${r.status}` };
      a.status = "sent";
      await putAsk(a);
      out.photos++;
    }
    const waiting = asks.filter((x) => x.status === "sent");
    if (waiting.length) {
      const r = await http("GET", `${base}/api/consults/replies?ids=${waiting.map((a) => encodeURIComponent(a.id)).join(",")}`);
      const replies = ok(r.status) ? ((r.data as { replies?: (OfficerReply & { id: string })[] } | null)?.replies ?? []) : [];
      for (const { id, ...reply } of replies) {
        const a = waiting.find((x) => x.id === id);
        if (!a) continue;
        await putAsk({ ...a, status: "answered", reply, seen: false });
        out.replies++;
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
