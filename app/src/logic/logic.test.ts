import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Band, gradeCherryPixels } from "../capture/cherry";
import { STRESS_CLASSES, type StressClass } from "../config";
import { buildSms, isGsm7, officerSms, smsUri, visitSms } from "../handoff/sms";
import { aggregate } from "./aggregate";
import type { Answers } from "./answers";
import { actionKey, buildCard } from "./card";
import { rankCauses } from "./causes";
import { type BuyerTickets, type Harvest, harvestFor, harvestSlot, NO_HARVEST, ticketRange } from "./harvest";
import { officerText, visitText } from "./officer";
import { refusalReason } from "./refusal";
import { computeTrend } from "./trend";
import type { ContextPack, Diagnosis, LeafResult, Observation, OfficerReply, Trend } from "./types";

const A: Answers = JSON.parse(readFileSync("public/content/answers.json", "utf8"));
const REG: BuyerTickets = JSON.parse(readFileSync("public/content/plots.json", "utf8")).buyer_tickets;
const TAU = 0.8;

function leaf(stress: StressClass, p: number, severity = 2): LeafResult {
  const k = STRESS_CLASSES.indexOf(stress);
  const rest = (1 - p) / 4;
  return { probs: STRESS_CLASSES.map((_, i) => (i === k ? p : rest)), stress, pMax: p, severity, ms: 10 };
}

describe("aggregate + refusal", () => {
  it("three agreeing confident leaves -> confident, median severity", () => {
    const d = aggregate([leaf("rust", 0.95, 2), leaf("rust", 0.9, 3), leaf("rust", 0.92, 4)], TAU);
    expect(d.kind).toBe("confident");
    if (d.kind === "confident") {
      expect(d.stress).toBe("rust");
      expect(d.severity).toBe(3);
    }
  });
  it("fewer than two good photos -> not_sure too_few_good_photos", () => {
    const d = aggregate([leaf("rust", 0.99)], TAU);
    expect(d).toMatchObject({ kind: "not_sure", reason: "too_few_good_photos" });
    expect(aggregate([], TAU)).toMatchObject({ kind: "not_sure", reason: "too_few_good_photos" });
  });
  it("low mean probability -> not_sure low_confidence", () => {
    const d = aggregate([leaf("rust", 0.6), leaf("rust", 0.65), leaf("rust", 0.7)], TAU);
    expect(d).toMatchObject({ kind: "not_sure", reason: "low_confidence" });
  });
  it("only one leaf votes for the candidate -> not_sure leaves_disagree", () => {
    // mean favours rust (one very confident leaf) but the other two say phoma / miner
    const a = leaf("rust", 1.0), b = leaf("phoma", 0.5), c = leaf("miner", 0.5);
    b.probs = [0, 0, 0.49, 0.51, 0]; c.probs = [0, 0.51, 0.49, 0, 0];
    expect(refusalReason({ goodPhotos: 3, pMeanMax: 0.9, votes: 1, tau: TAU })).toBe("leaves_disagree");
    const d = aggregate([a, b, c], 0.6);
    expect(d).toMatchObject({ kind: "not_sure", reason: "leaves_disagree" });
  });
  it("NaN confidence is refused", () => {
    expect(refusalReason({ goodPhotos: 3, pMeanMax: NaN, votes: 3, tau: TAU })).toBe("low_confidence");
  });
  it("healthy confident has severity 0", () => {
    const d = aggregate([leaf("healthy", 0.97, 0), leaf("healthy", 0.95, 1)], TAU);
    expect(d).toMatchObject({ kind: "confident", stress: "healthy", severity: 0 });
  });
});

function obs(p: Partial<Observation>): Observation {
  return {
    id: Math.random().toString(36), plotId: "OND-0017", block: "B", takenAt: "2026-09-20T10:00:00Z",
    stress: "rust", severity: 2, confidence: 0.9, answers: { changed: "nothing_new", sprayed: "no" },
    modelVersion: "0.1.0", synced: false, ...p,
  };
}

describe("trend", () => {
  const cur = { plotId: "OND-0017", block: "B", stress: "rust" as StressClass, severity: 3, takenAt: "2026-10-04T10:00:00Z" };
  it("first when no history", () => expect(computeTrend(cur, []).trend).toBe("first"));
  it("worse / same / better vs latest confident same block+stress", () => {
    expect(computeTrend(cur, [obs({ severity: 2 })])).toMatchObject({ trend: "worse", days: 14 });
    expect(computeTrend(cur, [obs({ severity: 3 })]).trend).toBe("same");
    expect(computeTrend(cur, [obs({ severity: 4 })]).trend).toBe("better");
  });
  it("same-day comparison says earlier today", () => {
    const r = computeTrend(cur, [obs({ severity: 2, takenAt: "2026-10-04T08:00:00Z" })]);
    expect(r).toMatchObject({ trend: "worse", days: 0 });
    const card = buildCard({ kind: "confident", stress: "rust", severity: 3, confidence: 0.95, pMean: [], agreeing: [0, 1] }, r,
      { causes: [], contextAvailable: false }, A, "en");
    expect(card.trend).toBe("Worse than the check earlier today.");
  });
  it("uses the most recent match", () => {
    const h = [obs({ severity: 1, takenAt: "2026-09-10T10:00:00Z" }), obs({ severity: 4, takenAt: "2026-09-30T10:00:00Z" })];
    expect(computeTrend(cur, h).trend).toBe("better");
  });
  it("ignores not_sure, other blocks, other stress, and anything older than 42 days", () => {
    const h = [
      obs({ stress: "not_sure", severity: null }),
      obs({ block: "A" }),
      obs({ stress: "phoma" }),
      obs({ takenAt: "2026-08-01T10:00:00Z" }),
    ];
    expect(computeTrend(cur, h).trend).toBe("first");
  });
});

const NOW = new Date("2026-10-04T12:00:00Z");
function pack(p: Partial<ContextPack>): ContextPack {
  return {
    plotId: "OND-0017", builtAt: "2026-10-03T20:00:00Z", source: { weather: "NASA POWER", soil: "ISRIC SoilGrids" },
    rain_30d_mm: 80, rain_30d_normal_mm: 80, rain_90d_mm: 250, rain_90d_normal_mm: 250,
    temp_mean_30d_c: 15, rh_mean_30d_pct: 60, soil_ph: 6.0, caveat: "", ...p,
  };
}
const rust3: Diagnosis = { kind: "confident", stress: "rust", severity: 3, confidence: 0.95, pMean: [], agreeing: [0, 1, 2] };
const healthy: Diagnosis = { kind: "confident", stress: "healthy", severity: 0, confidence: 0.95, pMean: [], agreeing: [0, 1] };
const unsure: Diagnosis = { kind: "not_sure", reason: "low_confidence", confidence: 0.5, pMean: [] };

describe("causes (F4)", () => {
  it("confident rust + warm wet weather -> disease first with weather note", () => {
    const r = rankCauses({ diagnosis: rust3, trend: "worse", sprayed: "no", now: NOW,
      pack: pack({ temp_mean_30d_c: 21, rh_mean_30d_pct: 82, rain_30d_mm: 140 }) });
    expect(r.causes[0]).toMatchObject({ key: "disease", weatherNote: true });
    expect(r.causes.at(-1)!.key).toBe("not_covered");
  });
  it("healthy leaves + dry spell -> dry_spell is the top cause, no disease", () => {
    const r = rankCauses({ diagnosis: healthy, trend: null, sprayed: "no", now: NOW, pack: pack({ rain_90d_mm: 90 }) });
    expect(r.causes[0].key).toBe("dry_spell");
    expect(r.causes.some((c) => c.key === "disease")).toBe(false);
  });
  it("not_sure image + acidic soil -> no disease cause, soil shown as context only", () => {
    const r = rankCauses({ diagnosis: unsure, trend: null, sprayed: "yes", now: NOW, pack: pack({ soil_ph: 4.6 }) });
    expect(r.causes.map((c) => c.key)).toEqual(["soil_acidity", "not_covered"]);
    expect(r.causes[0].contextOnly).toBe(true);
  });
  it("missing or stale context pack -> weather and soil skipped, context unavailable", () => {
    const r1 = rankCauses({ diagnosis: rust3, trend: null, sprayed: "no", now: NOW, pack: null });
    expect(r1.contextAvailable).toBe(false);
    expect(r1.causes.map((c) => c.key)).toEqual(["disease", "not_covered"]);
    const r2 = rankCauses({ diagnosis: healthy, trend: null, sprayed: "no", now: NOW,
      pack: pack({ builtAt: "2026-08-01T00:00:00Z", rain_90d_mm: 10, soil_ph: 4.0 }) });
    expect(r2.contextAvailable).toBe(false);
    expect(r2.causes.map((c) => c.key)).toEqual(["not_covered"]);
  });
  it("everything normal -> only not_covered", () => {
    const r = rankCauses({ diagnosis: healthy, trend: null, sprayed: "no", now: NOW, pack: pack({}) });
    expect(r.causes.map((c) => c.key)).toEqual(["not_covered"]);
  });
  it("sprayed recently only fires with a detected disease; max 3 scored + not_covered", () => {
    const r = rankCauses({ diagnosis: rust3, trend: "worse", sprayed: "yes", now: NOW,
      pack: pack({ rain_90d_mm: 50, soil_ph: 4.2, temp_mean_30d_c: 21, rh_mean_30d_pct: 85 }) });
    expect(r.causes.length).toBe(4);
    expect(r.causes.at(-1)!.key).toBe("not_covered");
  });
});

// Every possible card: all stresses x severities x trends, plus every not_sure reason.
function allDiagnoses(): { dx: Diagnosis; trend: Trend | null }[] {
  const out: { dx: Diagnosis; trend: Trend | null }[] = [];
  for (const s of STRESS_CLASSES) {
    const sevs = s === "healthy" ? [0] : [1, 2, 3, 4];
    for (const severity of sevs)
      for (const trend of ["first", "worse", "same", "better"] as Trend[])
        out.push({ dx: { kind: "confident", stress: s, severity, confidence: 0.9, pMean: [], agreeing: [] }, trend });
  }
  for (const reason of ["too_few_good_photos", "low_confidence", "leaves_disagree"] as const)
    out.push({ dx: { kind: "not_sure", reason, confidence: 0.4, pMean: null }, trend: null });
  return out;
}

describe("card + SMS", () => {
  const blocks = ["B", "Upper", "Lower-2"];
  it("every possible card builds and gives a single-segment GSM-7 SMS <= 160 chars in both languages", () => {
    let longest = "";
    for (const lang of ["en", "sw"] as const)
      for (const { dx, trend } of allDiagnoses())
        for (const block of blocks) {
          const ranking = rankCauses({ diagnosis: dx, trend, sprayed: "yes", now: NOW, pack: pack({ rain_90d_mm: 50, soil_ph: 4.2 }) });
          const card = buildCard(dx, trend ? { trend, days: 14, previous: null } : null, ranking, A, lang);
          for (const month of [0, 7, 10]) {
            const sms = buildSms(card, block, new Date(2026, month, 28), A, lang);
            expect(sms.length).toBeLessThanOrEqual(160);
            expect(isGsm7(sms)).toBe(true);
            if (sms.length > longest.length) longest = sms;
          }
        }
    console.log(`longest SMS (${longest.length}): ${longest}`);
  });
  it("matches the spec example format", () => {
    const ranking = rankCauses({ diagnosis: rust3, trend: "worse", sprayed: "no", now: NOW, pack: null });
    const card = buildCard({ ...rust3, severity: 2 }, { trend: "worse", days: 14, previous: null }, ranking, A, "en");
    expect(buildSms(card, "B", new Date(2026, 9, 4), A, "en")).toBe(
      "JIRANI 04-Oct Block B: RUST, low, worse. Do: tell coop this week. Dont: spray before officer sees it. Not sure? Ask a person.",
    );
  });
  it("not_sure card says ask a person and do not spray, with no heatmap-worthy stress", () => {
    const card = buildCard(unsure, null, rankCauses({ diagnosis: unsure, trend: null, sprayed: "no", now: NOW, pack: null }), A, "en");
    expect(card.stress).toBe("Not sure");
    expect(card.nextStep).toBe("Not sure. Ask a person.");
    expect(card.doNot).toBe("Do not spray.");
    expect(card.severity).toBeNull();
  });
  it("high severity or worse trend -> action contacts the cooperative / officer", () => {
    for (const { dx, trend } of allDiagnoses()) {
      if (dx.kind !== "confident" || dx.stress === "healthy") continue;
      if (dx.severity >= 3 || trend === "worse") {
        const key = actionKey(dx, trend);
        expect(A.action[key].en).toMatch(/cooperative/);
        expect(A.action[key].en).toMatch(/extension officer/);
        expect(A.action[key].sw).toMatch(/chama/);
      }
    }
  });
  it("the causes slot says it is rules over cached estimates, and when there is no fresh context", () => {
    for (const { dx, trend } of allDiagnoses()) {
      const stale = buildCard(dx, trend ? { trend, days: 14, previous: null } : null,
        rankCauses({ diagnosis: dx, trend, sprayed: "no", now: NOW, pack: null }), A, "en");
      expect(stale.ruleNote).toBe("Rain and soil are cached estimates, not a second model. They never override a low-confidence leaf.");
      expect(stale.contextNote).toBe("No fresh rain or soil note.");
      const fresh = buildCard(dx, trend ? { trend, days: 14, previous: null } : null,
        rankCauses({ diagnosis: dx, trend, sprayed: "no", now: NOW, pack: pack({}) }), A, "sw");
      expect(fresh.contextNote).toBeNull();
      expect(fresh.ruleNote).toBe(A.cause.rule_note.sw);
    }
  });
  it("sms: URI uses & on iOS and ? on Android", () => {
    expect(smsUri("+254 700 000000", "hi there", true)).toBe("sms:+254700000000&body=hi%20there");
    expect(smsUri("0700000000", "hi", false)).toBe("sms:0700000000?body=hi");
  });
});

// Cherry photo pixels: `red`, `green` and `black` shares of the frame on a white card (the rest is card).
function cherryPixels(red: number, green = 0, black = 0, background: [number, number, number] = [245, 245, 240]): Uint8ClampedArray {
  const n = 1000, d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const [r, g, b] = f < red ? [170, 25, 35] : f < red + green ? [90, 150, 50] : f < red + green + black ? [20, 14, 12] : background;
    d.set([r, g, b, 255], i * 4);
  }
  return d;
}

describe("harvest slot (cherry band + buyer tickets)", () => {
  const CURRENCY = /usd|kes|ksh|shilling|dollar|price|\$|€|£/i;
  it("the vision path gives a band or no grade, and never a currency amount", () => {
    const cases: [Uint8ClampedArray, Band | null, string | null][] = [
      [cherryPixels(0.4), "A", null],                           // ripe red on the card
      [cherryPixels(0.3, 0.05), "B", null],                     // some unripe fruit
      [cherryPixels(0.15, 0.2), "C", null],                     // mostly unripe
      [cherryPixels(0.2, 0, 0.1), "C", null],                   // blackened fruit
      [cherryPixels(0), null, "no_cherry"],                     // empty card
      [cherryPixels(0.01), null, "no_cherry"],
      [cherryPixels(0.95), null, "no_card"],                    // no card in view
      [cherryPixels(0.3, 0, 0, [70, 50, 35]), null, "dark"],    // on a dark table
      [cherryPixels(0, 0, 1), null, "dark"],                    // black frame
    ];
    for (const [pixels, band, issue] of cases) {
      const g = gradeCherryPixels(pixels);
      expect(g.band).toBe(band);
      expect(g.issue).toBe(issue);
      expect(Object.keys(g).sort()).toEqual(["band", "issue", "metrics"]);
      expect(Object.keys(g.metrics).sort()).toEqual(["card", "defect", "fruit", "ripe"]);   // shares of pixels only
      for (const v of Object.values(g.metrics)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(JSON.stringify(g)).not.toMatch(CURRENCY);
      // with no cooperative tickets, a graded photo puts no number at all on the card or in the SMS
      for (const lang of ["en", "sw"] as const) {
        const h = harvestFor(g, null);
        expect(h.range).toBeNull();
        const slot = harvestSlot(h, A, lang);
        expect(Object.values(slot).join(" ")).not.toMatch(/\d/);
        const card = buildCard(healthy, null, { causes: [], contextAvailable: false }, A, lang, h);
        const base = buildSms(buildCard(healthy, null, { causes: [], contextAvailable: false }, A, lang), "B", new Date(2026, 9, 4), A, lang);
        expect(buildSms(card, "B", new Date(2026, 9, 4), A, lang).slice(base.length)).not.toMatch(/\d/);
      }
    }
  });
  it("the ticket range is the last three cooperative tickets of that band, from the registry", () => {
    expect(REG.synthetic).toBe(true);
    expect(ticketRange(REG, "B")).toEqual({ low: 310, high: 340, unit: "USD/50kg", synthetic: true });
    const older: BuyerTickets = { ...REG, tickets: [...REG.tickets, { id: "x", date: "2020-01-01", band: "B", price: 5 }] };
    expect(ticketRange(older, "B")).toMatchObject({ low: 310, high: 340 });   // a fourth, older ticket is not used
    expect(ticketRange({ ...REG, tickets: [] }, "A")).toBeNull();
    expect(ticketRange(null, "A")).toBeNull();
  });
  it("slot text: with a band, with a photo that could not be graded, and with no photo", () => {
    const b = harvestSlot(harvestFor({ band: "B", issue: null, metrics: { fruit: 0.3, card: 0.6, ripe: 0.7, defect: 0.1 } }, REG), A, "en");
    expect(`${b.text} ${b.tickets}`).toBe("Band B. Last coop tickets 310–340 USD/50kg. Not a price offer.");
    expect(b.prototype).toBe("Prototype grade, not a trained model. Confirm at the factory.");
    expect(b.synthetic).toBe("Demo tickets are synthetic, not market prices.");
    expect(harvestSlot(NO_HARVEST, A, "en")).toMatchObject({ bandKey: null, text: "No cherry photo. No grade.", tickets: null, prototype: null });
    const unclear = harvestFor({ band: null, issue: "no_cherry", metrics: { fruit: 0, card: 1, ripe: 0, defect: 0 } }, REG);
    expect(harvestSlot(unclear, A, "en")).toMatchObject({ bandKey: null, text: "Cherry photo not clear. No grade.", tickets: null });
    for (const lang of ["en", "sw"] as const)
      for (const h of [NO_HARVEST, unclear, ...(["A", "B", "C"] as Band[]).map((band): Harvest => ({ photo: true, band, range: ticketRange(REG, band) }))])
        expect(Object.values(harvestSlot(h, A, lang)).join(" ")).not.toMatch(/[{}]/);
  });
  it("refusal still wins: a cherry band never changes a not-sure result", () => {
    const h: Harvest = { photo: true, band: "A", range: ticketRange(REG, "A") };
    const ranking = rankCauses({ diagnosis: unsure, trend: null, sprayed: "no", now: NOW, pack: null });
    const plain = buildCard(unsure, null, ranking, A, "en");
    const card = buildCard(unsure, null, ranking, A, "en", h);
    expect(card.harvest.bandKey).toBe("A");
    expect({ ...card, harvest: null, harvestInput: null }).toEqual({ ...plain, harvest: null, harvestInput: null });
    expect(card).toMatchObject({ confident: false, stress: "Not sure", nextStep: "Not sure. Ask a person.", doNot: "Do not spray." });
    expect(buildSms(card, "B", new Date(2026, 9, 4), A, "en")).toMatch(/^JIRANI 04-Oct Block B: NOT SURE\. .* Ask a person\. Band A/);
  });
  it("the SMS gains the band only when there is one, drops the ticket range first, and stays one GSM-7 segment", () => {
    let withRange = 0, bandOnly = 0, dropped = 0;
    for (const lang of ["en", "sw"] as const)
      for (const { dx, trend } of allDiagnoses())
        for (const block of ["B", "Upper", "Lower-2"]) {
          const ranking = rankCauses({ diagnosis: dx, trend, sprayed: "no", now: NOW, pack: null });
          const tr = trend ? { trend, days: 14, previous: null } : null;
          const base = buildSms(buildCard(dx, tr, ranking, A, lang), block, new Date(2026, 10, 28), A, lang);
          // no cherry photo, or a photo with no grade: the SMS is unchanged
          expect(buildSms(buildCard(dx, tr, ranking, A, lang, { photo: true, band: null, range: null }), block, new Date(2026, 10, 28), A, lang)).toBe(base);
          for (const band of ["A", "B", "C"] as Band[]) {
            const range = ticketRange(REG, band)!;
            const sms = buildSms(buildCard(dx, tr, ranking, A, lang, { photo: true, band, range }), block, new Date(2026, 10, 28), A, lang);
            expect(sms.length).toBeLessThanOrEqual(160);
            expect(isGsm7(sms)).toBe(true);
            expect(sms.startsWith(base)).toBe(true);
            const extra = sms.slice(base.length);
            if (extra.includes(`${range.low}-${range.high} ${range.unit}`)) withRange++;
            else if (extra) { bandOnly++; expect(extra).toBe(lang === "en" ? ` Band ${band}.` : ` Daraja ${band}.`); }
            else dropped++;
          }
        }
    console.log(`SMS harvest fragment: ${withRange} with ticket range, ${bandOnly} band only, ${dropped} dropped (no room)`);
    expect(withRange).toBeGreaterThan(0);
    expect(bandOnly).toBeGreaterThan(dropped);
    // the range fits only on short messages; on most disease cards it is dropped and the band stays
    const short = buildCard(unsure, null, { causes: [], contextAvailable: false }, A, "en", { photo: true, band: "B", range: ticketRange(REG, "B") });
    expect(buildSms(short, "B", new Date(2026, 9, 4), A, "en")).toMatch(/ Band B, tickets 310-340 USD\/50kg, no offer\.$/);
    const long = buildCard(rust3, { trend: "worse", days: 14, previous: null }, { causes: [], contextAvailable: false }, A, "en",
      { photo: true, band: "B", range: ticketRange(REG, "B") });
    expect(buildSms(long, "B", new Date(2026, 9, 4), A, "en")).toMatch(/Ask a person\. Band B\.$/);
  });
});

describe("officer reply (ask the officer)", () => {
  const replies: OfficerReply[] = [
    ...STRESS_CLASSES.flatMap((stress) => (["low", "high"] as const).map((band): OfficerReply => (
      { verdict: "diagnosis", stress, band, answeredAt: "2026-11-28T10:00:00Z" }))),
    { verdict: "visit", answeredAt: "2026-11-28T10:00:00Z" },
    { verdict: "retake", answeredAt: "2026-11-28T10:00:00Z" },
  ];
  it("every reply has fixed text and a single-segment GSM-7 SMS in both languages", () => {
    for (const lang of ["en", "sw"] as const)
      for (const r of replies) {
        const text = officerText(r, A, lang);
        expect(text.headline.length).toBeGreaterThan(10);
        expect(text.headline).not.toMatch(/[{}]/);
        for (const block of ["B", "Upper", "Lower-2"]) {
          const sms = officerSms(r, block, A, lang);
          expect(sms.length).toBeLessThanOrEqual(160);
          expect(isGsm7(sms)).toBe(true);
        }
      }
  });
  it("a diagnosis reply uses the same action and do-not text as the card", () => {
    const text = officerText({ verdict: "diagnosis", stress: "rust", band: "high", answeredAt: "2026-10-04T08:00:00Z" }, A, "en");
    expect(text.headline).toBe("The officer looked at your photos: Leaf rust.");
    expect(text.action).toBe(A.action["rust.high"].en);
    expect(text.doNot).toBe(A.do_not.rust.en);
    expect(officerText({ verdict: "visit", answeredAt: "2026-10-04T08:00:00Z" }, A, "en").action).toBeNull();
  });
});

describe("officer visit", () => {
  it("says when the officer comes and what to do until then, and fits one SMS in both languages", () => {
    for (const lang of ["en", "sw"] as const)
      for (const slot of ["morning", "afternoon"] as const)
        for (const block of ["B", "Lower-22"]) {
          const v = { id: 1, block, stress: "rust", date: "2026-11-28", slot };
          const text = visitText(v, "Saturday 28 November", A, lang);
          expect(text.when).toContain("Saturday 28 November");
          expect(text.when).not.toMatch(/[{}]/);
          expect(text.until).toHaveLength(4);
          const sms = visitSms(v, A, lang);
          expect(sms.length).toBeLessThanOrEqual(160);
          expect(isGsm7(sms)).toBe(true);
        }
    expect(visitSms({ id: 1, block: "B", stress: "rust", date: "2026-10-06", slot: "morning" }, A, "en")).toBe(
      "JIRANI: officer visits Block B on 06-Oct, morning. Until then: do not spray, keep the 3 leaves, check 10 more trees.",
    );
  });
});

describe("content safety scan", () => {
  // No pesticide/fungicide/product names, no dosages. Scans every string in answers.json and i18n.
  const BANNED = [
    "copper", "cupric", "oxychloride", "hydroxide", "bordeaux", "mancozeb", "triadimefon", "cyproconazole",
    "propiconazole", "tebuconazole", "hexaconazole", "azoxystrobin", "pyraclostrobin", "trifloxystrobin",
    "chlorothalonil", "carbendazim", "chlorpyrifos", "imidacloprid", "thiamethoxam", "cypermethrin",
    "deltamethrin", "lambda-cyhalothrin", "diazinon", "dimethoate", "glyphosate", "sulphur", "sulfur",
    "fungicide", "insecticide", "pesticide", "herbicide", "chemical", "dose", "dosage", "litre", "liter",
    "kiuatilifu", "viuatilifu", "dawa ya", "kemikali", "mbolea ya",
  ];
  const DOSE = /\d+(\.\d+)?\s*(ml|l|cl|g|kg|mg|cc|%|gram|grams|lita|kilo)\b/i;
  const files = ["public/content/answers.json", "public/content/i18n/en.json", "public/content/i18n/sw.json", "public/audio/ki/manifest.json"];
  function strings(x: unknown): string[] {
    if (typeof x === "string") return [x];
    if (Array.isArray(x)) return x.flatMap(strings);
    if (x && typeof x === "object") return Object.values(x).flatMap(strings);
    return [];
  }
  for (const f of files) {
    it(`${f} has no chemical names or dosages`, () => {
      const all = strings(JSON.parse(readFileSync(f, "utf8")));
      expect(all.length).toBeGreaterThan(10);
      for (const s of all) {
        const low = s.toLowerCase();
        for (const b of BANNED) expect(low.includes(b), `"${b}" in: ${s}`).toBe(false);
        expect(DOSE.test(s), `dose-like text in: ${s}`).toBe(false);
      }
    });
  }
});

describe("audio pack", () => {
  it("every possible card's clip sequence exists in the Kiswahili manifest, plus question prompts", async () => {
    const { cardClipKeys } = await import("../handoff/audio");
    const manifest = JSON.parse(readFileSync("public/audio/sw/manifest.json", "utf8")).clips as Record<string, string>;
    for (const { dx, trend } of allDiagnoses()) {
      const ranking = rankCauses({ diagnosis: dx, trend, sprayed: "no", now: NOW, pack: null });
      const card = buildCard(dx, trend ? { trend, days: 3, previous: null } : null, ranking, A, "sw");
      for (const k of cardClipKeys(card)) {
        expect(manifest[k], `missing clip ${k}`).toBeTruthy();
        expect(existsSync(`public/audio/sw/${manifest[k]}`)).toBe(true);
      }
    }
    for (const k of ["prompt.block", "prompt.changed", "prompt.sprayed"]) expect(manifest[k]).toBeTruthy();
  });
  it("cherry band clips exist, and each ticket clip says the range the registry gives", async () => {
    const { cardClipKeys } = await import("../handoff/audio");
    const m = JSON.parse(readFileSync("public/audio/sw/manifest.json", "utf8"));
    for (const band of ["A", "B", "C"] as Band[]) {
      const range = ticketRange(REG, band)!;
      expect(m.spoken[`harvest.tickets.${band}`], `stale ticket clip ${band}: run scripts/build_audio.py --missing after deleting it`)
        .toEqual({ low: range.low, high: range.high, unit: range.unit });
      const card = buildCard(rust3, null, { causes: [], contextAvailable: false }, A, "sw", { photo: true, band, range });
      const keys = cardClipKeys(card, m.spoken);
      expect(keys.slice(-2)).toEqual([`harvest.band.${band}`, `harvest.tickets.${band}`]);
      for (const k of keys) expect(existsSync(`public/audio/sw/${m.clips[k]}`), `missing clip ${k}`).toBe(true);
      // a clip recorded for other amounts is not played
      const other = buildCard(rust3, null, { causes: [], contextAvailable: false }, A, "sw", { photo: true, band, range: { ...range, high: range.high + 1 } });
      expect(cardClipKeys(other, m.spoken).at(-1)).toBe(`harvest.band.${band}`);
    }
    const none = buildCard(rust3, null, { causes: [], contextAvailable: false }, A, "sw");
    expect(cardClipKeys(none, m.spoken).some((k) => k.startsWith("harvest."))).toBe(false);
  });
  it("Gikuyu pack is phrase-locked: three prompts, a few confirmations, and any clip it claims is on disk", () => {
    const ki = JSON.parse(readFileSync("public/audio/ki/manifest.json", "utf8"));
    expect(Object.keys(ki.clips).filter((k) => k.startsWith("prompt."))).toEqual(["prompt.block", "prompt.changed", "prompt.sprayed"]);
    expect(Object.keys(ki.clips).filter((k) => k.startsWith("confirm.")).length).toBeLessThanOrEqual(5);
    let recorded = 0;
    for (const [k, c] of Object.entries(ki.clips as Record<string, { file: string; recorded: boolean }>)) {
      if (c.recorded) { recorded++; expect(existsSync(`public/audio/ki/${c.file}`), `missing Gikuyu clip ${k}`).toBe(true); }
    }
    expect(ki.placeholder).toBe(recorded < Object.keys(ki.clips).length);   // the visible note follows this flag
  });
});
