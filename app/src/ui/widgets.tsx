// Shared UI pieces: app bar, bottom navigation, dialog, toast, badges and meters.
import {
  ArrowLeft, Bug, CircleDot, CircleHelp, History as HistoryIcon, House, Leaf, type LucideIcon, Minus, Send, Settings as SettingsIcon,
  TrendingDown, TrendingUp, Wifi, WifiOff,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import type { Lang, Trend } from "../logic/types";
import { t } from "./i18n";

export type Tab = "home" | "history" | "sync" | "settings";

const STRESS_ICON: Record<string, LucideIcon> = {
  healthy: Leaf, miner: Bug, rust: CircleDot, phoma: CircleDot, cercospora: CircleDot, not_sure: CircleHelp,
};

/** The leaf mark from public/icon.svg (same as the launcher icon). */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="4 9 48 46" aria-hidden>
      <path d="M14 40c0-14 12-24 34-26-2 22-12 34-26 34-3 0-6-1-8-3l-4 5-3-2 5-5c1-1 2-2 2-3z" fill="#009fda" />
      <path d="M20 44c8-8 14-14 22-22" stroke="#002244" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Round icon badge for a stress class. Colour carries the class, the icon carries the kind. */
export function StressBadge({ stress, size = 40 }: { stress: string; size?: number }) {
  const I = STRESS_ICON[stress] ?? CircleHelp;
  return (
    <span className={`stress-badge s-${stress}`} style={{ width: size, height: size }} aria-hidden>
      <I size={Math.round(size * 0.55)} strokeWidth={2.4} />
    </span>
  );
}

/** Tone of a result: drives the colour of the card hero and of list rows. */
export function toneOf(stress: string, severity: number | null): "ok" | "warn" | "bad" | "unsure" {
  if (stress === "not_sure") return "unsure";
  if (stress === "healthy") return "ok";
  return (severity ?? 0) >= 3 ? "bad" : "warn";
}

/** Four-step severity scale (levels 1 to 4; 0 = none). */
export function SeverityMeter({ level }: { level: number }) {
  return (
    <span className="meter" aria-hidden>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= level ? `on l${level}` : ""} />)}
    </span>
  );
}

export function TrendIcon({ trend, size = 18 }: { trend: Trend | string | null | undefined; size?: number }) {
  if (trend === "worse") return <TrendingUp size={size} className="t-worse" aria-hidden />;
  if (trend === "better") return <TrendingDown size={size} className="t-better" aria-hidden />;
  if (trend === "same") return <Minus size={size} className="t-same" aria-hidden />;
  return null;
}

export function LangSwitch({ lang, set }: { lang: Lang; set: (l: Lang) => void }) {
  return (
    <span className="lang" role="group" aria-label="Language">
      <button className={lang === "sw" ? "on" : ""} aria-pressed={lang === "sw"} onClick={() => set("sw")}>SW</button>
      <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => set("en")}>EN</button>
    </span>
  );
}

export function AppBar({ lang, setLang, title, onBack, online }: {
  lang: Lang; setLang: (l: Lang) => void; title?: string; onBack?: () => void; online?: boolean;
}) {
  return (
    <header className="appbar">
      {onBack
        ? <button className="icon-btn" aria-label={t(lang, "back")} onClick={onBack}><ArrowLeft size={24} /></button>
        : <Logo />}
      <h1>{title ?? "Jirani"}</h1>
      {online !== undefined && (
        <span className={`net ${online ? "on" : "off"}`}>
          {online ? <Wifi size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
          {t(lang, online ? "status_online" : "status_offline")}
        </span>
      )}
      <LangSwitch lang={lang} set={setLang} />
    </header>
  );
}

const TABS: { id: Tab; icon: LucideIcon; label: string }[] = [
  { id: "home", icon: House, label: "home" },
  { id: "history", icon: HistoryIcon, label: "history" },
  { id: "sync", icon: Send, label: "sync" },
  { id: "settings", icon: SettingsIcon, label: "settings" },
];

export function BottomNav({ lang, tab, go, queued }: { lang: Lang; tab: Tab; go: (t: Tab) => void; queued: number }) {
  return (
    <nav className="bottomnav">
      {TABS.map(({ id, icon: I, label }) => (
        <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
          <span className="pill">
            <I size={22} aria-hidden />
            {id === "sync" && queued > 0 && <b className="count">{queued}</b>}
          </span>
          {t(lang, label)}
        </button>
      ))}
    </nav>
  );
}

export interface DialogSpec {
  title: string;
  body?: string;
  confirm: string;
  cancel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void; // the cancel button; dismissing (scrim, back button) only closes
}

export function Dialog({ spec, close }: { spec: DialogSpec; close: () => void }) {
  return (
    <div className="scrim" onClick={close}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={spec.title} onClick={(e) => e.stopPropagation()}>
        <h2>{spec.title}</h2>
        {spec.body && <p>{spec.body}</p>}
        <div className="dialog-actions">
          <button className="btn text" onClick={() => { close(); spec.onCancel?.(); }}>{spec.cancel}</button>
          <button className={`btn ${spec.danger ? "danger-fill" : "primary"}`} onClick={() => { close(); spec.onConfirm(); }}>{spec.confirm}</button>
        </div>
      </div>
    </div>
  );
}

export interface ToastSpec { text: string; tone?: "ok" | "bad"; id: number }

export function Toast({ toast, clear }: { toast: ToastSpec; clear: () => void }) {
  useEffect(() => {
    const h = setTimeout(clear, 3500);
    return () => clearTimeout(h);
  }, [toast.id]);
  return <div className={`toast ${toast.tone ?? ""}`} role="status">{toast.text}</div>;
}

export function Banner({ tone, icon, children }: { tone: "info" | "ok" | "warn" | "bad"; icon: ReactNode; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{icon}<div>{children}</div></div>;
}

export function Choice<T extends string>({ options, value, set }: {
  options: { v: T; label: string; icon?: ReactNode }[]; value: T | null | ""; set: (v: T) => void;
}) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button key={o.v} className={`choice ${value === o.v ? "on" : ""}`} aria-pressed={value === o.v} onClick={() => set(o.v)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function fmtDate(iso: string, lang: Lang, withYear = false): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) };
  try {
    return new Date(iso).toLocaleDateString(lang === "sw" ? "sw-KE" : "en-GB", opts);
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

/** A calendar day ("2026-10-06") with its weekday, for visit dates. */
export function fmtDay(day: string, lang: Lang): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  const d = new Date(`${day}T12:00:00`);
  try {
    return d.toLocaleDateString(lang === "sw" ? "sw-KE" : "en-GB", opts);
  } catch {
    return d.toLocaleDateString();
  }
}
