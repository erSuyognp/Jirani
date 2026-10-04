// Typed access to content/answers.json. Every user-facing sentence on the card comes through here.
import type { Lang } from "./types";

export type Text = Record<Lang, string>;
export interface Answers {
  review_status: string;
  version: string;
  stress: Record<string, Text>;
  severity: Record<string, Text>;
  trend: Record<string, Text>;
  confidence: Record<string, Text>;
  not_sure_reason: Record<string, Text>;
  action: Record<string, Text>;
  do_not: Record<string, Text>;
  next_step: Record<string, Text>;
  cause: Record<string, { evidence?: Text; confirm?: Text } & Partial<Text>>;
  harvest: Record<string, Text>;
  card: Record<string, Text>;
  officer: Record<string, Text>;
  visit: Record<string, Text>;
  sms: {
    template_confident: Text;
    template_not_sure: Text;
    template_officer: Text;
    officer_visit: Text;
    officer_retake: Text;
    visit: Text;
    harvest: Text;
    harvest_tickets: Text;
    slot: Record<string, Text>;
    months: Record<Lang, string[]>;
    stress: Record<string, Text>;
    severity: Record<string, Text>;
    trend: Record<string, Text>;
    action: Record<string, Text>;
    do_not: Record<string, Text>;
  };
}

export function fill(template: string, slots: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in slots)) throw new Error(`missing slot ${k}`);
    return String(slots[k]);
  });
}

export function pick(t: Text | undefined, lang: Lang, key: string): string {
  if (!t || typeof t[lang] !== "string") throw new Error(`missing answer text: ${key} (${lang})`);
  return t[lang];
}
