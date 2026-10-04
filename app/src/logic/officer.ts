// The officer's reply, as shown on the phone. The officer picks from a fixed list on the dashboard;
// every sentence here still comes from answers.json by key.
import { officerActionKey } from "../handoff/sms";
import { type Answers, fill, pick } from "./answers";
import type { Lang, OfficerReply } from "./types";

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
