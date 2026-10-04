// The officer's reply, as shown on the phone. The officer picks from a fixed list on the dashboard;
// every sentence here still comes from answers.json by key.
import { officerActionKey } from "../handoff/sms";
import { type Answers, fill, pick } from "./answers";
import type { Lang, OfficerReply, Visit } from "./types";

export interface OfficerText { headline: string; action: string | null; doNot: string | null }

export function officerText(reply: OfficerReply, A: Answers, lang: Lang): OfficerText {
  if (reply.verdict === "diagnosis" && reply.stress) {
    const key = officerActionKey(reply);
    return {
      headline: fill(pick(A.officer.says, lang, "officer.says"), { stress: pick(A.stress[reply.stress], lang, "stress") }),
      action: pick(A.action[key], lang, `action.${key}`),
      doNot: pick(A.do_not[reply.stress], lang, `do_not.${reply.stress}`),
    };
  }
  const key = reply.verdict === "visit" ? "visit" : "retake";
  return { headline: pick(A.officer[key], lang, `officer.${key}`), action: null, doNot: null };
}

/** "The officer will visit Block B on ..." plus what to do until then. `date` is already formatted for the screen. */
export function visitText(v: Visit, date: string, A: Answers, lang: Lang): { when: string; until: string[] } {
  return {
    when: fill(pick(A.visit.scheduled, lang, "visit.scheduled"), { block: v.block, date, slot: pick(A.visit[v.slot], lang, "visit.slot") }),
    until: [1, 2, 3, 4].map((i) => pick(A.visit[`until_${i}`], lang, `visit.until_${i}`)),
  };
}
