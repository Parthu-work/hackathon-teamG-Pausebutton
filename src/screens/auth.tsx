"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Screen } from "@/components/ui";
import { post } from "@/lib/client/api";

/** A0 · Welcome */
export function WelcomeScreen() {
  const router = useRouter();
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

/** A1 · Sign in (mock, no real auth) */
export function SignInScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[i] = d;
    setCode(next);
    if (d && i < 3) boxes.current[i + 1]?.focus();
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ redirect: string }>("/api/auth/sign-in", { phone, code: code.join("") });
      router.push(r.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function demo(persona: "rao" | "arjun") {
    setBusy(true);
    const r = await post<{ redirect: string }>("/api/auth/demo", { persona }).catch((e: Error) => {
      setError(e.message);
      setBusy(false);
      return null;
    });
    if (r) router.push(r.redirect);
  }

  return (
    <Screen>
      <div className="row">
        <span className="pm"><i /><i /></span>
        <b className="display" style={{ fontSize: 20 }}>Pause Button</b>
      </div>
      <h1 className="h1">Sign in</h1>
      <p className="p">Use your mobile number. We send a 4-digit code.</p>
      <label>
        <div className="lbl">Mobile number</div>
        <div className="in" style={{ marginTop: 6 }}>
          <input inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </label>
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
                maxLength={1}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && boxes.current[i - 1]?.focus()}
              />
            </div>
          ))}
        </div>
        <p className="sm" style={{ marginTop: 6 }}>Demo code: 1234</p>
      </div>
      {error && (
        <div className="row" style={{ gap: 8, color: "var(--red-text)", fontWeight: 700, fontSize: 15 }}>
          <Icon name="warn" size={20} />
          {error}
        </div>
      )}
      <button className="btn ink" disabled={busy} onClick={signIn}>Sign in</button>
      <div className="row">
        <div className="grow" style={{ height: 1, background: "var(--border-strong)" }} />
        <span className="sm">or skip for the demo</span>
        <div className="grow" style={{ height: 1, background: "var(--border-strong)" }} />
      </div>
      <button className="btn line" disabled={busy} onClick={() => demo("rao")}>Continue as Mr Rao (demo)</button>
      <button className="btn line" disabled={busy} onClick={() => demo("arjun")}>Continue as Arjun (demo)</button>
      <p className="sm">Demo sign-in only. No real code is sent and no real money is involved.</p>
    </Screen>
  );
}

/** A2 · Choose role (first sign-in only) */
export function RoleScreen() {
  const router = useRouter();
  const [role, setRole] = useState<"protected" | "family">("protected");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    try {
      const r = await post<{ redirect: string }>("/api/auth/role", { role, name: name.trim() || undefined });
      router.push(r.redirect);
    } catch (e) {
      setError((e as Error).message);
    }
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
        <div className="in" style={{ marginTop: 6 }}>
          <input placeholder="e.g. Mr Rao" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </label>
      {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
      <div className="spacer" />
      <button className="btn ink" onClick={go}>Continue</button>
      <p className="sm center-text">The person who wants protection sets up first and invites family. Family joins with a code.</p>
    </Screen>
  );
}
