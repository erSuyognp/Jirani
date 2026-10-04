// Link to the printable capture card (public/capture-card.pdf, bundled and precached).
// Browser: opens the PDF. Android app: the WebView cannot show a PDF, so the file goes to the native share sheet
// (print, send to the cooperative's computer, or open in a PDF viewer).
import { FileText } from "lucide-react";
import { shareOrDownload } from "../handoff/audio";
import type { Lang } from "../logic/types";
import { t } from "./i18n";
import { isNative } from "./native";

const HREF = `${import.meta.env.BASE_URL}capture-card.pdf`;

export function CardLink({ lang }: { lang: Lang }) {
  const label = <><FileText size={15} aria-hidden /> {t(lang, "card_link")}</>;
  if (!isNative) return <a className="hint card-link" href={HREF} target="_blank" rel="noopener">{label}</a>;
  async function share() {
    try {
      const pdf = await (await fetch(HREF)).blob();
      await shareOrDownload(new File([pdf], "jirani-capture-card.pdf", { type: "application/pdf" }));
    } catch { /* share sheet dismissed */ }
  }
  return <button className="hint card-link" onClick={share}>{label}</button>;
}
