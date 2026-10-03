// Store-and-forward. Packets wait in IndexedDB until the user opens Sync and presses Send.
// Packet carries no name, phone number, photo or device location: plot id + class only.
import { enqueue, markSynced, outbox, type Packet } from "../db/db";
import type { Observation } from "../logic/types";

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

/** Only called from the Send button. On failure everything stays queued (idempotent by id on the server). */
export async function send(serverUrl: string): Promise<{ ok: boolean; sent: number; error?: string }> {
  const packets = await pending();
  if (!packets.length) return { ok: true, sent: 0 };
  try {
    const r = await fetch(`${serverUrl.replace(/\/$/, "")}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packets),
    });
    if (!r.ok) return { ok: false, sent: 0, error: `HTTP ${r.status}` };
    await markSynced(packets.map((p) => p.id));
    return { ok: true, sent: packets.length };
  } catch (e) {
    return { ok: false, sent: 0, error: String(e) };
  }
}
