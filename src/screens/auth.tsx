"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Screen, useCountdown } from "@/components/ui";
import { api, post } from "@/lib/client/api";

/**
 * Runs `again` when a sign-in screen comes back as it was left instead of
 * starting fresh: Back to it (Next keeps a visited screen alive but hidden,
 * and shows it again with its state) or the browser restoring the whole page
 * from its back/forward cache. The screens use it so a sign-in that already
 * went through never leaves a button disabled, and refresh so that someone
 * signed in by then is sent on to their own home (the server decides).
 */
function useShownAgain(again: () => void) {
  const latest = useRef(again);
  useLayoutEffect(() => {
    latest.current = again;
  });
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) latest.current();
    shown.current = true;
    const restored = (e: PageTransitionEvent) => {
      if (e.persisted) latest.current();
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
}

function Brand() {
  return (
    <div className="row">
      <span className="pm"><i /><i /></span>
      <b className="display" style={{ fontSize: 20 }}>Pause Button</b>
    </div>
  );
}

function ErrorRow({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="row" role="alert" style={{ gap: 8, color: "var(--red-text)", fontWeight: 700, fontSize: 15 }}>
      <Icon name="warn" size={20} />
      {error}
    </div>
  );
}

/** A0 · Welcome */
export function WelcomeScreen() {
  const router = useRouter();
  useShownAgain(() => router.refresh());
  return (
    <Screen tone="ink" center bodyStyle={{ gap: 22, color: "#fff" }}>
      <span className="pm big"><i /><i /></span>
      <h1 className="h1" style={{ fontSize: 44, color: "#fff" }}>Pause Button</h1>
      <p className="p" style={{ fontSize: 22, color: "#ECE8E0" }}>A calm second opinion, before the money moves.</p>
      <div style={{ height: 24 }} />
      <button className="btn amber" onClick={() => router.push("/sign-in")}>Get started</button>
      <button className="btn whiteline" onClick={() => router.push("/sign-in")}>I already have an account</button>
      <p className="sm" style={{ color: "#B9C4CD" }}>Apty Hackathon 2026 prototype. No real messages. No real money.</p>
    </Screen>
  );
}

/** What POST /api/auth/code answers. demoCode: only in demo mode, and only in this one answer. */
type Issued = { phone: string; expiresAt: string; resendAt: string; serverNow: string; demoCode?: string };
type Persona = "rao" | "mom" | "arjun" | "meera";
const NO_CODE = ["", "", "", ""];

/**
 * A1 · Sign in: the mobile number, then the 4-digit code for it. In demo mode
 * the code is shown on this screen, once, instead of sent by SMS: it lives in
 * this screen's state only, so a reload or Back never shows it again.
 */
export function SignInScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const [phone, setPhone] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [code, setCode] = useState(NO_CODE);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // Demo sign-in is off on a public deploy (DEMO_SIGNIN); the form shows until we know.
  const offer = useQuery({
    queryKey: ["sign-in-open"],
    queryFn: () => api<{ open: boolean; codes: "screen" | "sms" | "off" }>("/api/auth/demo"),
  });

  const fail = (e: Error) => setError(e.message);
  const send = useMutation({
    mutationFn: () => post<Issued>("/api/auth/code", { phone }),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setIssued(r);
      setCode(NO_CODE);
      // The code step gets its own history entry, so the phone's Back returns to the number.
      if (new URLSearchParams(window.location.search).get("step") !== "code") window.history.pushState(null, "", "?step=code");
    },
    onError: fail,
  });
  const signIn = useMutation({
    mutationFn: (v: { phone: string; code: string }) => post<{ redirect: string }>("/api/auth/sign-in", v),
    onMutate: () => setError(null),
    onSuccess: (r) => router.replace(r.redirect),
    onError: fail,
  });
  const demo = useMutation({
    mutationFn: (persona: Persona) => post<{ redirect: string }>("/api/auth/demo", { persona }),
    onMutate: () => setError(null),
    onSuccess: (r) => router.replace(r.redirect),
    onError: fail,
  });
  // From the tap until the next screen is up. A sign-in that went through keeps
  // the buttons disabled only until this screen is shown again.
  const busy = send.isPending || signIn.isPending || signIn.isSuccess || demo.isPending || demo.isSuccess;

  const forgetCode = useCallback(() => {
    setIssued(null);
    setCode(NO_CODE);
    setError(null);
  }, []);

  useShownAgain(() => {
    forgetCode();
    send.reset();
    signIn.reset();
    demo.reset();
    router.refresh();
  });

  useEffect(() => {
    // A reload on the code step starts again at the number: the code is not kept anywhere.
    if (new URLSearchParams(window.location.search).has("step")) window.history.replaceState(null, "", window.location.pathname);
    // Back from the code step: that code is off the screen for good (Resend gives a new one).
    const moved = () => {
      if (new URLSearchParams(window.location.search).get("step") !== "code") forgetCode();
    };
    window.addEventListener("popstate", moved);
    return () => window.removeEventListener("popstate", moved);
  }, [forgetCode]);

  const onCodeStep = issued !== null && search.get("step") === "code";
  useEffect(() => {
    if (onCodeStep) boxes.current[0]?.focus();
  }, [onCodeStep, issued]);

  const expiry = useCountdown(issued?.expiresAt, issued?.serverNow);
  const resendIn = Math.ceil(useCountdown(issued?.resendAt, issued?.serverNow).left / 1000);
  const complete = code.every((d) => d !== "");

  function typeDigit(i: number, v: string) {
    const digits = v.replace(/\D/g, "");
    // A whole code at once (pasted, or filled in from the SMS): spread it over the boxes.
    if (digits.length >= NO_CODE.length) {
      setCode(digits.slice(0, NO_CODE.length).split(""));
      boxes.current[NO_CODE.length - 1]?.focus();
      return;
    }
    const next = [...code];
    next[i] = digits.slice(-1);
    setCode(next);
    if (next[i] && i < NO_CODE.length - 1) boxes.current[i + 1]?.focus();
  }

  if (offer.data?.codes === "off") {
    return (
      <Screen>
        <Brand />
        <h1 className="h1">Sign-in is not open yet</h1>
        <p className="p">This site is not taking new sign-ins. If your family set it up for you, ask them for help.</p>
      </Screen>
    );
  }

  if (onCodeStep) {
    return (
      <Screen>
        <Brand />
        <h1 className="h1">Type the code</h1>
        <p className="p">{issued.demoCode ? `Your code for ${issued.phone}:` : `We sent a 4-digit code to ${issued.phone}.`}</p>
        {issued.demoCode && (
          <>
            <div className="card tint-amber" data-testid="demo-code" style={{ alignItems: "center", gap: 2, padding: 14 }}>
              <span className="lbl" style={{ color: "var(--text)" }}>Your code:</span>
              <b className="display" style={{ fontSize: 40, letterSpacing: ".3em" }}>{issued.demoCode.split("").join(" ")}</b>
            </div>
            <p className="sm">Demo: no SMS is sent. The code is shown here this once.</p>
          </>
        )}
        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && complete && !expiry.expired) signIn.mutate({ phone: issued.phone, code: code.join("") });
          }}
        >
          <div>
            <div className="lbl">Code</div>
            <div className="row" style={{ marginTop: 6, gap: 10 }}>
              {code.map((d, i) => (
                <div key={i} className="in grow" style={{ justifyContent: "center", fontSize: 26, fontWeight: 800, textAlign: "center" }}>
                  <input
                    ref={(el) => {
                      boxes.current[i] = el;
                    }}
                    aria-label={`Code digit ${i + 1}`}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={NO_CODE.length}
                    value={d}
                    onChange={(e) => typeDigit(i, e.target.value)}
                    onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && boxes.current[i - 1]?.focus()}
                  />
                </div>
              ))}
            </div>
            {!expiry.expired && <p className="sm" style={{ marginTop: 6 }} data-testid="code-expiry">The code works for {expiry.label} more.</p>}
          </div>
          <ErrorRow error={expiry.expired ? "That code has expired. Tap Resend." : error} />
          <button className="btn ink" type="submit" disabled={busy || !complete || expiry.expired}>Sign in</button>
        </form>
        <button className="btn line" disabled={busy || resendIn > 0} onClick={() => send.mutate()}>
          {resendIn > 0 ? `Resend code in ${resendIn} s` : "Resend code"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => window.history.back()}>Change number</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Brand />
      <h1 className="h1">Sign in</h1>
      <p className="p">Use your mobile number. We send a 4-digit code.</p>
      {offer.data?.codes === "screen" && <p className="sm">Demo: no SMS is sent. The code is shown on the next screen instead, once.</p>}
      <form
        style={{ display: "contents" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) send.mutate();
        }}
      >
        <label>
          <div className="lbl">Mobile number</div>
          <div className="in" style={{ marginTop: 6 }}>
            <input inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </label>
        <ErrorRow error={error} />
        <button className="btn ink" type="submit" disabled={busy}>Send code</button>
      </form>
      {offer.data?.open !== false && (
        <>
          <div className="row">
            <div className="grow" style={{ height: 1, background: "var(--border-strong)" }} />
            <span className="sm">or skip for the demo</span>
            <div className="grow" style={{ height: 1, background: "var(--border-strong)" }} />
          </div>
          <button className="btn line" disabled={busy} onClick={() => demo.mutate("rao")}>Continue as Mr Rao (demo)</button>
          <button className="btn line" disabled={busy} onClick={() => demo.mutate("mom")}>Continue as Mrs Rao (demo)</button>
          <button className="btn line" disabled={busy} onClick={() => demo.mutate("arjun")}>Continue as Arjun (demo)</button>
          <button className="btn line" disabled={busy} onClick={() => demo.mutate("meera")}>Continue as Meera (demo)</button>
          <p className="sm">Demo sign-in only. No real money is involved.</p>
        </>
      )}
    </Screen>
  );
}

/** A2 · Choose role and name (first sign-in only). suggestedName: the name family invited this number by. */
export function RoleScreen({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [role, setRole] = useState<"protected" | "family">("protected");
  const [name, setName] = useState(suggestedName);
  // Shown once they try to go on (or leave the box) without a name.
  const [nameMissing, setNameMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const named = name.trim().length > 0;
  const go = useMutation({
    mutationFn: () => post<{ redirect: string }>("/api/auth/role", { role, name: name.trim() }),
    onMutate: () => setError(null),
    onSuccess: (r) => router.replace(r.redirect),
    onError: (e: Error) => setError(e.message),
  });
  // A double tap sends it once; after it went through, only until this screen is shown again.
  const busy = go.isPending || go.isSuccess;
  useShownAgain(() => {
    go.reset();
    router.refresh();
  });

  function goOn() {
    if (!named) setNameMissing(true);
    else if (!busy) go.mutate();
  }

  const option = (value: "protected" | "family", title: string, sub: string, icon: "shieldCheck" | "people") => (
    <button
      className="card row-card"
      style={{ border: role === value ? "3px solid var(--text)" : "2px solid #B9C4CD", padding: 18, gap: 14 }}
      onClick={() => setRole(value)}
      aria-pressed={role === value}
    >
      <span className="circle" style={{ width: 52, height: 52, background: role === value ? "#F2A900" : "var(--chip)", color: "#14202B" }}>
        <Icon name={icon} />
      </span>
      <div className="grow">
        <div className="h2" style={{ fontSize: 22 }}>{title}</div>
        <p className="sm" style={{ marginTop: 4 }}>{sub}</p>
      </div>
      <span className={`rad ${role === value ? "on" : ""}`} style={{ width: 26, height: 26, borderWidth: 3 }} />
    </button>
  );

  return (
    <Screen>
      <h1 className="h1" style={{ marginTop: 12 }}>Who is this phone for?</h1>
      <p className="p">Pick one. You can add the other person next.</p>
      {option("protected", "I want protection", "I get messages I am not sure about.", "shieldCheck")}
      {option("family", "I protect someone", "I am family. Alert me when a message looks like a scam.", "people")}
      <label>
        <div className="lbl">Your name</div>
        <div className={`in ${nameMissing && !named ? "err" : ""}`} style={{ marginTop: 6 }}>
          <input
            placeholder="e.g. Ramesh Rao"
            autoComplete="name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goOn()}
            onBlur={() => setNameMissing(!named)}
          />
        </div>
      </label>
      <ErrorRow error={nameMissing && !named ? "Please enter your name." : error} />
      <div className="spacer" />
      <button className={`btn ${named ? "ink" : "off"}`} disabled={!named || busy} onClick={goOn}>Continue</button>
      <p className="sm center-text">The person who wants protection sets up first and invites family. Family joins with a code.</p>
    </Screen>
  );
}
