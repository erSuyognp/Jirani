// Templated single-segment SMS for the basic phone. The user presses send in their own SMS app.
import { CONFIG } from "../config";
import { type Answers, fill, pick } from "../logic/answers";
import type { Card } from "../logic/card";
import type { Lang } from "../logic/types";

// GSM 03.38 basic character set (no extension table, so every char is 1 septet).
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

export function isGsm7(s: string): boolean {
  for (const ch of s) if (!GSM7.includes(ch)) return false;
  return true;
}

export function smsDate(d: Date, A: Answers, lang: Lang): string {
  return `${String(d.getDate()).padStart(2, "0")}-${A.sms.months[lang][d.getMonth()]}`;
}

export function buildSms(card: Card, block: string, date: Date, A: Answers, lang: Lang): string {
  const S = A.sms;
  const high = card.actionKey.endsWith(".high");
  const action = pick(high ? S.action.high : S.action[card.actionKey], lang, `sms.action.${card.actionKey}`);
  const donot = pick(S.do_not[card.stressKey], lang, `sms.do_not.${card.stressKey}`);
  const base = { date: smsDate(date, A, lang), block: block.slice(0, 8), action, donot }; // capped for one segment
  const body = card.confident
    ? fill(pick(S.template_confident, lang, "sms.template"), {
        ...base,
        stress: pick(S.stress[card.stressKey], lang, "sms.stress"),
        severity: pick(S.severity[String(card.severityKey)], lang, "sms.severity"),
        trend: pick(S.trend[card.trendKey ?? "first"], lang, "sms.trend"),
      })
    : fill(pick(S.template_not_sure, lang, "sms.template_not_sure"), base);
  if (body.length > CONFIG.sms.maxChars || !isGsm7(body)) {
    throw new Error(`SMS not single-segment GSM-7 (${body.length} chars): ${body}`);
  }
  return body;
}

export function isIOS(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /iPhone|iPad|iPod/i.test(ua);
}

/** sms: URI. iOS separates the body with "&", Android with "?". */
export function smsUri(phone: string, body: string, ios = isIOS()): string {
  const to = phone.replace(/[^\d+]/g, "");
  return `sms:${to}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`;
}
