// IndexedDB: observations, outbox queue, settings. Everything stays on this phone until the user taps Send.
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Lang, Observation } from "../logic/types";

export interface Packet {
  id: string;
  plotId: string;
  block: string;
  stress: string;
  severity: number | null;
  trend: string | null;
  confidence: number;
  takenAt: string;
  modelVersion: string;
}

export interface Settings {
  lang: Lang;
  plotId: string | null;
  blocks: string[];
  phone: string;
  showLatency: boolean;
  serverUrl: string;
}

interface JiraniDB extends DBSchema {
  observations: { key: string; value: Observation; indexes: { byTime: string } };
  outbox: { key: string; value: Packet };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<JiraniDB>> | null = null;
function db() {
  dbp ??= openDB<JiraniDB>("jirani", 1, {
    upgrade(d) {
      const o = d.createObjectStore("observations", { keyPath: "id" });
      o.createIndex("byTime", "takenAt");
      d.createObjectStore("outbox", { keyPath: "id" });
      d.createObjectStore("kv");
    },
  });
  return dbp;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "sw",
  plotId: null,
  blocks: [],
  phone: "",
  showLatency: true,
  serverUrl: "http://localhost:8000",
};

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await (await db()).get("kv", "settings")) as Partial<Settings> | undefined) };
}
export async function saveSettings(s: Settings) {
  await (await db()).put("kv", s, "settings");
}

export async function addObservation(o: Observation) {
  await (await db()).put("observations", o);
}
export async function allObservations(): Promise<Observation[]> {
  return (await db()).getAllFromIndex("observations", "byTime");
}

export async function enqueue(p: Packet) {
  await (await db()).put("outbox", p); // idempotent by id
}
export async function outbox(): Promise<Packet[]> {
  return (await db()).getAll("outbox");
}
export async function markSynced(ids: string[]) {
  const d = await db();
  const tx = d.transaction(["outbox", "observations"], "readwrite");
  for (const id of ids) {
    await tx.objectStore("outbox").delete(id);
    const o = await tx.objectStore("observations").get(id);
    if (o) await tx.objectStore("observations").put({ ...o, synced: true });
  }
  await tx.done;
}

/** "Clear all data on this phone" (lost or shared phones). */
export async function clearAll() {
  const d = await db();
  await Promise.all([d.clear("observations"), d.clear("outbox"), d.clear("kv")]);
}
