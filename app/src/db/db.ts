// IndexedDB: observations, outbox queue, "ask the officer" photos, settings.
// Everything stays on this phone until the user taps Send.
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Ask, Lang, Observation, Visit } from "../logic/types";
import { SIM } from "../sim";

export interface Packet {
  synthetic?: boolean;  // set only in simulation mode
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
  asks: { key: string; value: Ask };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<JiraniDB>> | null = null;
function db() {
  dbp ??= openDB<JiraniDB>(SIM ? "jirani-sim" : "jirani", 2, { // the simulation never touches real data
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const o = d.createObjectStore("observations", { keyPath: "id" });
        o.createIndex("byTime", "takenAt");
        d.createObjectStore("outbox", { keyPath: "id" });
        d.createObjectStore("kv");
      }
      if (oldVersion < 2) d.createObjectStore("asks", { keyPath: "id" });
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
  serverUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
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

export async function putAsk(a: Ask) {
  await (await db()).put("asks", a);
}
export async function allAsks(): Promise<Ask[]> {
  return (await db()).getAll("asks");
}

/** Officer visits for this plot, as last fetched from the cooperative. */
export async function getVisits(): Promise<Visit[]> {
  return ((await (await db()).get("kv", "visits")) as Visit[] | undefined) ?? [];
}
export async function saveVisits(v: Visit[]) {
  await (await db()).put("kv", v, "visits");
}

/** "Clear all data on this phone" (lost or shared phones). */
export async function clearAll() {
  const d = await db();
  await Promise.all([d.clear("observations"), d.clear("outbox"), d.clear("asks"), d.clear("kv")]);
}
