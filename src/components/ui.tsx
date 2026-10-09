"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SIGNAL_LABEL } from "@/lib/check/copy";
import { SIGNAL_TYPES, type Evidence, type LinkInfo, type SignalType, type Verdict } from "@/lib/check/types";
import { ApiError } from "@/lib/client/api";
import { telHref } from "@/lib/phone";
import { Icon, type IconName } from "./icons";

// ---------------- phone frame ----------------

export type Tone = "red" | "amber" | "green" | "ink" | "amber-tint" | null;
type FrameCtx = { setTone: (t: Tone) => void };
const FrameContext = createContext<FrameCtx>({ setTone: () => {} });

/** The phone (.ph) lives in the app shell so banners and toasts survive navigation. */
export function PhoneFrame({ children, size, overlays }: { children: React.ReactNode; size?: string; overlays?: React.ReactNode }) {
  const [tone, setTone] = useState<Tone>(null);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const on = () => setFlash((n) => n + 1);
    window.addEventListener("pb-flash", on);
    return () => window.removeEventListener("pb-flash", on);
  }, []);
  const solid = tone === "red" || tone === "amber" || tone === "green" || tone === "ink";
  return (
    <FrameContext.Provider value={useMemo(() => ({ setTone }), [])}>
      <div className="stage">
        <div className={`ph ${tone ? `tone-${tone}` : ""} ${solid ? "inv" : ""}`} data-size={size}>
          {children}
          {overlays}
          <ToastOutlet />
          {flash > 0 && <div key={flash} className="flash" />}
        </div>
      </div>
    </FrameContext.Provider>
  );
}

/** One screen inside the phone: the demo bar, the scrolling body and optional tabs. */
export function Screen({
  tone = null,
  sim,
  center,
  tabs,
  children,
  overlay,
  bodyStyle,
  note,
}: {
  tone?: Tone;
  sim?: boolean;
  center?: boolean;
  tabs?: React.ReactNode;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  bodyStyle?: React.CSSProperties;
  note?: React.ReactNode;
}) {
  const { setTone } = useContext(FrameContext);
  useLayoutEffect(() => {
    setTone(tone);
    return () => setTone(null);
  }, [tone, setTone]);
  return (
    <>
      <div className="syn">SYNTHETIC DEMO DATA</div>
      {sim && <div className="simbar">SIMULATED MESSAGES · NOT REAL</div>}
      {note}
      <div className={`bd ${center ? "center" : ""}`} style={bodyStyle}>
        {children}
      </div>
      {tabs}
      {overlay}
    </>
  );
}

export function LoadingScreen({ title = "Loading…" }: { title?: string }) {
  return (
    <Screen>
      <div className="row">
        <span className="pm"><i /><i /></span>
        <b className="grow display" style={{ fontSize: 20 }}>{title}</b>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card" style={{ gap: 10 }}>
          <div className="row">
            <span className="sk" style={{ flex: "none", width: 44, height: 44, borderRadius: 12 }} />
            <div className="grow col">
              <span className="sk" style={{ width: "70%" }} />
              <span className="sk" style={{ width: "45%", height: 10 }} />
            </div>
          </div>
        </div>
      ))}
    </Screen>
  );
}

// ---------------- navigation ----------------

export function BackButton({ href, label, onClick }: { href?: string; label?: string; onClick?: () => void }) {
  const router = useRouter();
  return (
    <button className="back" aria-label={label ?? "Back"} onClick={onClick ?? (() => (href ? router.push(href) : router.back()))}>
      <Icon name="back" />
      {label && <span>{label}</span>}
    </button>
  );
}

export function TitleRow({ title, back, right }: { title: string; back?: string | (() => void); right?: React.ReactNode }) {
  return (
    <div className="row">
      {back !== undefined && <BackButton href={typeof back === "string" ? back : undefined} onClick={typeof back === "function" ? back : undefined} />}
      <h1 className="h2 grow">{title}</h1>
      {right}
    </div>
  );
}

export function RaoTabs({ active, labels }: { active: "check" | "checks" | "settings"; labels?: { check: string; checks: string; settings: string } }) {
  const l = labels ?? { check: "Check", checks: "My checks", settings: "Settings" };
  return (
    <nav className="tabs">
      <Link className={`tab ${active === "check" ? "on" : ""}`} href="/"><Icon name="shield" />{l.check}</Link>
      <Link className={`tab ${active === "checks" ? "on" : ""}`} href="/history"><Icon name="list" />{l.checks}</Link>
      <Link className={`tab ${active === "settings" ? "on" : ""}`} href="/settings"><Icon name="gear" />{l.settings}</Link>
    </nav>
  );
}

export function FamilyTabs({ active, callName }: { active: "home" | "activity" | "settings"; callName: string }) {
  return (
    <nav className="tabs">
      <Link className={`tab ${active === "home" ? "on" : ""}`} href="/family"><Icon name="shield" />{callName}</Link>
      <Link className={`tab ${active === "activity" ? "on" : ""}`} href="/family/activity"><Icon name="list" />Activity</Link>
      <Link className={`tab ${active === "settings" ? "on" : ""}`} href="/family/settings"><Icon name="gear" />Settings</Link>
    </nav>
  );
}

// ---------------- pieces ----------------

const VERDICT_STYLE: Record<Verdict, { cls: string; icon: IconName }> = {
  SCAM: { cls: "red", icon: "warn" },
  SUSPICIOUS: { cls: "amber", icon: "warn" },
  SAFE: { cls: "green", icon: "check" },
};

export function VerdictPill({ verdict, size = "big", icon = true, label }: { verdict: Verdict; size?: "big" | "medium" | "small"; icon?: boolean; label?: string }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className={`pill ${s.cls} ${size === "big" ? "" : size}`} data-verdict={verdict}>
      {icon && size === "big" && <Icon name={s.icon} />}
      {label ?? verdict}
    </span>
  );
}

export function StatusPill({ label }: { label: string }) {
  const cls = label === "SCAM" ? "red" : label === "SUSPICIOUS" || label === "EXPIRED" ? "amber" : label === "SAFE" || label === "APPROVED" ? "green" : "ink";
  return <span className={`pill small ${cls}`}>{label}</span>;
}

export function Marks({ phrases, size = 17 }: { phrases: string[]; size?: number }) {
  if (!phrases.length) return null;
  return (
    <div style={{ fontSize: size, lineHeight: 1.7 }}>
      {phrases.map((p, i) => (
        <span key={i}>
          <mark>“{p}”</mark>{" "}
        </span>
      ))}
    </div>
  );
}

/** Labels the signal rows can show in Mr Rao's language (F5); English when left out. */
export type SignalWords = {
  labels?: Record<SignalType, string>;
  notFound?: string;
  words?: string;
  link?: string;
  unknownSite?: string;
  scamSite?: string;
  fakeSite?: string;
};

export function SignalBars({ signals, amber, labels }: { signals: Evidence[]; amber?: boolean; labels?: Record<SignalType, string> }) {
  const found = new Set(signals.map((s) => s.type));
  return (
    <div className={`seg ${amber ? "am" : ""}`}>
      {SIGNAL_TYPES.map((t) => (
        <div key={t} className={found.has(t) ? "f" : ""}>
          <b />
          {labels?.[t] ?? SIGNAL_LABEL[t]}
        </div>
      ))}
    </div>
  );
}

export function SignalRows({ signals, link, modelTerms, words }: { signals: Evidence[]; link: LinkInfo | null; modelTerms?: string[]; words?: SignalWords }) {
  return (
    <div className="col">
      {SIGNAL_TYPES.map((t) => {
        const found = signals.filter((s) => s.type === t);
        return (
          <div className="mv" key={t}>
            <span className="lbl">{words?.labels?.[t] ?? SIGNAL_LABEL[t]}</span>
            {found.length ? (
              <span className="phr">
                {found.slice(0, 2).map((s, i) => (
                  <mark key={i}>{s.phrase}</mark>
                ))}
              </span>
            ) : (
              <span className="sm">{words?.notFound ?? "Not found"}</span>
            )}
          </div>
        );
      })}
      {link && link.status !== "known" && (
        <div className="mv">
          <span className="lbl">{words?.link ?? "Link"}</span>
          <mark style={{ wordBreak: "break-all" }}>{link.domain}</mark>
          <span className="grow" />
          <span className="tag">
            {link.status === "unknown" || link.status === "risky" ? words?.unknownSite ?? "UNKNOWN SITE" : link.status === "blocked" ? words?.scamSite ?? "SCAM SITE" : words?.fakeSite ?? "FAKE SITE"}
          </span>
        </div>
      )}
      {!!modelTerms?.length && !signals.length && (
        <div className="mv">
          <span className="lbl">{words?.words ?? "Words"}</span>
          <span className="phr">
            {modelTerms.map((t) => (
              <mark key={t}>{t}</mark>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`tog ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="handle" />
        {children}
      </div>
    </>
  );
}

export function Avatar({ name, size = 48, initials }: { name: string; size?: number; initials?: string }) {
  const text = initials ?? (name.match(/\b\p{L}/gu) ?? [name[0]]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="av" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {text}
    </span>
  );
}

export function Ring({ fraction, label, sub }: { fraction: number; label: string; sub: string }) {
  const c = 2 * Math.PI * 96;
  return (
    <div className="ring">
      <svg width="220" height="220" viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r="96" fill="none" stroke="#14202B" strokeOpacity=".2" strokeWidth="14" />
        <circle
          cx="110" cy="110" r="96" fill="none" stroke="#14202B" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))} transform="rotate(-90 110 110)"
        />
      </svg>
      <div className="t">
        <div className="display" style={{ fontWeight: 800, fontSize: 56, lineHeight: 1 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{sub}</div>
      </div>
    </div>
  );
}

// ---------------- client-only values ----------------

const noSubscribe = () => () => {};

/** A value only the phone knows (its clock, its microphone): `server` while rendering on the server, `get()` after hydration. */
export function useClientValue<T>(get: () => T, server: T): T {
  return useSyncExternalStore(noSubscribe, get, () => server);
}

/** The wall clock, refreshed every `ms`; null on the server. */
export function useNow(ms = 10_000): Date | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const t = setInterval(onChange, ms);
      return () => clearInterval(t);
    },
    [ms],
  );
  const tick = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / ms), () => -1);
  return tick < 0 ? null : new Date(tick * ms);
}

// ---------------- time ----------------

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function dayTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return `Today ${clockTime(iso)}`;
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Counts down to an ISO time, corrected by the server clock offset. */
export function useCountdown(expiresAt: string | undefined, serverNow?: string, totalMs = 10 * 60_000) {
  // `now` is the server-corrected clock, refreshed every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const offset = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;
    const tick = () => setNow(Date.now() + offset);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [serverNow]);
  if (!expiresAt) return { left: 0, label: "00:00", fraction: 0, expired: true };
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return { left, label: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, fraction: left / totalMs, expired: left <= 0 };
}

// ---------------- toasts ----------------

type Toast = { id: number; title: string; sub?: string; icon?: IconName; tone?: "green" | "red" };
const ToastContext = createContext<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void }>({ toasts: [], push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => {
      // A double tap shows one toast, not two of the same.
      const last = list[list.length - 1];
      if (last && last.title === t.title && last.sub === t.sub) return list;
      return [...list.slice(-2), { ...t, id }];
    });
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4000);
  }, []);
  return <ToastContext.Provider value={useMemo(() => ({ toasts, push }), [toasts, push])}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext).push;

export function ToastOutlet({ style }: { style?: React.CSSProperties }) {
  const { toasts } = useContext(ToastContext);
  return (
    <div className="toasts" aria-live="polite" style={style}>
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="circle" style={{ background: t.tone === "red" ? "#C6372B" : "#2E7D5B" }}>
            <Icon name={t.icon ?? "check"} />
          </span>
          <div className="grow">
            <b style={{ fontSize: 16 }}>{t.title}</b>
            {t.sub && <small>{t.sub}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** When the record behind a screen is gone (e.g. after "Reset demo data"), go home instead of loading forever. */
export function useLeaveIfGone(error: Error | null, href: string) {
  const router = useRouter();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) router.replace(href);
  }, [error, href, router]);
}

/** True on phones and tablets: there "Call" opens the dialer. */
function isPhone() {
  return window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * "Call Arjun" / "Call Papa" / "Call cyber helpline 1930". On a phone this
 * opens the phone's dialer with the number filled in (the person still taps
 * the green call button). On a laptop, e.g. the demo panel, it shows the number.
 */
export function useCall(words?: { noNumber: string; addNumber: string; callShows: string; onPhoneDialer: string }) {
  const toast = useToast();
  return useCallback(
    (who: string, phone: string | null | undefined) => {
      if (!phone) {
        toast({ title: words ? words.noNumber.replace("{name}", who) : `No number for ${who}`, sub: words?.addNumber ?? "Add it in Settings › Trusted people", icon: "phone", tone: "red" });
        return;
      }
      if (isPhone()) {
        window.location.href = telHref(phone);
        return;
      }
      toast({ title: words ? words.callShows.replace("{name}", who).replace("{phone}", phone) : `Call ${who}: ${phone}`, sub: words?.onPhoneDialer ?? "On a phone this opens the dialer.", icon: "phone" });
    },
    [toast, words],
  );
}

/**
 * A message with its warning phrases marked. With `numbers`, each phrase gets
 * the number of its signal (F1 "Why we think so"); links can be tapped (G3).
 */
export function HighlightedText({
  text,
  signals,
  link,
  numbers,
  onLink,
  size = 16,
}: {
  text: string;
  signals: Evidence[];
  link: LinkInfo | null;
  numbers?: Map<string, number>;
  onLink?: () => void;
  size?: number;
}) {
  type Span = { start: number; end: number; n?: number; link?: boolean };
  const spans: Span[] = [];
  const add = (sp: Span) => {
    if (sp.start < 0 || sp.end > text.length || sp.end <= sp.start) return;
    // Offsets are only trusted if they still point at the same words.
    if (!spans.some((x) => x.start < sp.end && sp.start < x.end)) spans.push(sp);
  };
  signals.forEach((sg) => text.slice(sg.start, sg.end) === sg.phrase && add({ start: sg.start, end: sg.end, n: numbers?.get(sg.type) }));
  if (link && link.status !== "known") add({ start: link.start, end: link.end, link: true });
  spans.sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((sp, i) => {
    if (sp.start > at) out.push(text.slice(at, sp.start));
    const piece = text.slice(sp.start, sp.end);
    out.push(
      sp.link && onLink ? (
        <button key={i} onClick={onLink} style={{ background: "none", padding: 0, textDecoration: "underline", color: "inherit", font: "inherit" }}>
          <mark>{piece}</mark>
        </button>
      ) : (
        <span key={i}>
          <mark>{piece}</mark>
          {sp.n && <sup>{sp.n}</sup>}
        </span>
      ),
    );
    at = sp.end;
  });
  out.push(text.slice(at));
  return <p className="p" style={{ fontSize: size, lineHeight: 1.55, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{out}</p>;
}
