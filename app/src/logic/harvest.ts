// Harvest slot of the card: the cherry band (from the optional fourth photo) next to what cooperative buyers
// paid for that band on the last few tickets. The tickets come from the cooperative registry (plots.json), never
// from the photo: the vision path gives a band only. Every sentence is looked up by key in answers.json.
import type { Band, CherryGrade } from "../capture/cherry";
import { CONFIG } from "../config";
import { type Answers, fill, pick } from "./answers";
import type { Lang } from "./types";

export interface BuyerTicket { id: string; date: string; band: Band; price: number }
export interface BuyerTickets { synthetic: boolean; factory: string; unit: string; tickets: BuyerTicket[] }

export interface TicketRange { low: number; high: number; unit: string; synthetic: boolean }

/** What the check knows about the harvest: no cherry photo, a photo that could not be graded, or a band. */
export interface Harvest { photo: boolean; band: Band | null; range: TicketRange | null }

export const NO_HARVEST: Harvest = { photo: false, band: null, range: null };

/** Range of the last few buyer tickets for one band, or null when the registry has none. */
export function ticketRange(reg: BuyerTickets | null | undefined, band: Band): TicketRange | null {
  const last = (reg?.tickets ?? []).filter((x) => x.band === band && Number.isFinite(x.price))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-CONFIG.harvest.ticketCount);
  if (!last.length || !reg) return null;
  const prices = last.map((x) => x.price);
  return { low: Math.min(...prices), high: Math.max(...prices), unit: reg.unit, synthetic: reg.synthetic !== false };
}

export function harvestFor(grade: CherryGrade | null, reg: BuyerTickets | null | undefined): Harvest {
  if (!grade) return NO_HARVEST;
  return { photo: true, band: grade.band, range: grade.band ? ticketRange(reg, grade.band) : null };
}

export interface HarvestSlot {
  bandKey: Band | null;
  text: string;                 // "Band B." | "No cherry photo. No grade." | "Cherry photo not clear. No grade."
  prototype: string | null;     // shown with every band: the grade is a prototype
  tickets: string | null;       // "Last coop tickets 310–340 USD/50kg. Not a price offer."
  synthetic: string | null;     // shown when the tickets are demo data
}

export function harvestSlot(h: Harvest, A: Answers, lang: Lang): HarvestSlot {
  const H = A.harvest;
  if (!h.band) {
    const key = h.photo ? "not_graded" : "none";
    return { bandKey: null, text: pick(H[key], lang, `harvest.${key}`), prototype: null, tickets: null, synthetic: null };
  }
  return {
    bandKey: h.band,
    text: fill(pick(H.band, lang, "harvest.band"), { band: h.band }),
    prototype: pick(H.prototype, lang, "harvest.prototype"),
    tickets: h.range ? fill(pick(H.tickets, lang, "harvest.tickets"), { low: h.range.low, high: h.range.high, unit: h.range.unit }) : pick(H.no_tickets, lang, "harvest.no_tickets"),
    synthetic: h.range?.synthetic ? pick(H.synthetic, lang, "harvest.synthetic") : null,
  };
}
