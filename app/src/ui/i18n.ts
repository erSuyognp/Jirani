import type { Lang } from "../logic/types";

export type Strings = Record<string, string>;
let tables: Record<Lang, Strings> = { en: {}, sw: {} };

export async function loadStrings(base: string) {
  const [en, sw] = await Promise.all(
    (["en", "sw"] as const).map((l) => fetch(`${base}content/i18n/${l}.json`).then((r) => r.json())),
  );
  tables = { en, sw };
}

/** Look up a UI string by key; {slots} are filled from vars. Missing keys show the key (visible in testing). */
export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = tables[lang][key] ?? tables.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
