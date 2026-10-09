"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { RaoTabs, Screen, useCall, useToast } from "@/components/ui";
import examples from "@/data/examples.json";
import { SIGNAL_LABEL } from "@/lib/check/copy";
import { SIGNAL_TYPES } from "@/lib/check/types";
import { ApiError, post } from "@/lib/client/api";
import { saveMessage } from "@/lib/client/messages";
import { useHelper, useRao } from "./shell";

const MAX = 4000;
const TITLES: Record<string, string> = {
  cbi: "CBI parcel message",
  kyc: "Bank KYC link",
  courier: "Courier fee message",
  lottery: "Lottery win message",
  bank: "Bank debit alert",
};

/** D1 · Home · D2 · Message ready · D3 · Checking · Q3 · Service unreachable */
export function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const call = useCall();
  const toast = useToast();
  const { data } = useRao();
  const helper = useHelper();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "checking" | "error">("edit");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (phase !== "checking") return;
    const t = setInterval(() => setProgress((p) => Math.min(92, p + 9)), 180);
    return () => clearInterval(t);
  }, [phase]);

  const linked = data?.people.some((p) => p.status === "linked");

  async function check() {
    setProgress(8);
    setPhase("checking");
    const started = Date.now();
    try {
      const title = picked && examples.find((e) => e.id === picked)?.text === text ? TITLES[picked] : undefined;
      const r = await post<{ checkId: string; verdict: string }>("/api/me/checks", { text, title });
      saveMessage(r.checkId, text.trim());
      // Let the "reading" moment land (~1.5 s) even when the check is instant.
      await new Promise((res) => setTimeout(res, Math.max(0, 1500 - (Date.now() - started))));
      setProgress(100);
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      router.push(r.verdict === "SCAM" ? `/check/${r.checkId}/stop` : `/check/${r.checkId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) {
        setPhase("edit");
        toast({ title: "Could not check this", sub: e.message, icon: "warn", tone: "red" });
      } else setPhase("error");
    }
  }

  if (phase === "error") {
    return (
      <Screen>
        <div className="note"><Icon name="wifi" />Reconnecting…</div>
        <div style={{ display: "flex", justifyContent: "center", margin: "18px 0 6px" }}>
          <span className="circle" style={{ width: 120, height: 120, background: "var(--red-tint)", color: "var(--red-text)", boxShadow: "0 0 0 14px rgba(242,169,0,.10)" }}>
            <Icon name="wifi" size={48} />
          </span>
        </div>
        <h1 className="h1 center-text">We could not reach the check service</h1>
        <p className="p center-text" style={{ color: "var(--muted)" }}>
          Nothing was sent. If a message asks for money or secrecy, do not pay. Call {helper.first}.
        </p>
        <div className="spacer" />
        <button className="btn amber" onClick={check}>Try again</button>
        <button className="btn line" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />Call {helper.first}</button>
      </Screen>
    );
  }

  if (phase === "checking") {
    return (
      <Screen tabs={<RaoTabs active="check" />}>
        <div className="row">
          <span className="pm"><i /><i /></span>
          <b className="grow display" style={{ fontSize: 20 }}>Pause Button</b>
        </div>
        <h1 className="h1" style={{ marginTop: 6 }}>Reading it with you…</h1>
        <div className="card" style={{ gap: 4 }}>
          <div className="lbl">Your message</div>
          <p className="p" style={{ fontSize: 16, color: "var(--muted)" }}>{text.length > 110 ? text.slice(0, 110) + "…" : text}</p>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--track2)", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "#F2A900", transition: "width .2s" }} />
        </div>
        <div className="card" style={{ gap: 14 }}>
          {SIGNAL_TYPES.map((t) => (
            <div className="row" key={t}>
              <span className="lbl" style={{ width: 92 }}>{SIGNAL_LABEL[t]}</span>
              <span className="sk" />
              <span className="tag">CHECKING</span>
            </div>
          ))}
        </div>
        <p className="sm">If the AI is slow, our rules still give you an answer. You will see a grey note when that happens.</p>
        <div className="spacer" />
        <button className="btn off big" disabled>Please wait…</button>
      </Screen>
    );
  }

  const ready = text.trim().length > 0;
  return (
    <Screen tabs={<RaoTabs active="check" />}>
      <div className="row">
        <span className="pm"><i /><i /></span>
        <b className="grow display" style={{ fontSize: 20 }}>Pause Button</b>
        {linked ? (
          <span className="tag" style={{ background: "var(--green-tint)", color: "var(--green-ink)" }}>
            {helper.first.toUpperCase()} IS YOUR HELPER
          </span>
        ) : (
          <Link className="tag a" href="/setup" style={{ textDecoration: "none" }}>ADD A HELPER</Link>
        )}
      </div>
      <h1 className="h1" style={{ marginTop: 6 }}>Got a worrying message?</h1>
      {!ready && <p className="p">Paste it here, or pick an example. We read it with you.</p>}
      <textarea
        className="ta"
        aria-label="Message to check"
        placeholder="Paste the message here"
        value={text}
        maxLength={MAX}
        style={{ minHeight: ready ? 170 : 150 }}
        onChange={(e) => {
          setText(e.target.value);
          setPicked(null);
        }}
      />
      {ready && (
        <div className="row">
          <span className="sm grow">{text.length.toLocaleString("en-IN")} of 4,000 characters</span>
          <button className="ghost" onClick={() => { setText(""); setPicked(null); }}>Clear</button>
        </div>
      )}
      {!ready && <div className="lbl">Or try an example</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        {examples.map((e) => (
          <button
            key={e.id}
            className={`chip ${picked === e.id ? "on" : ""}`}
            onClick={() => {
              setText(e.text);
              setPicked(e.id);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
      <Link href="/inbox" className="ghost" style={{ alignSelf: "flex-start", fontSize: 15 }}>
        <Icon name="msg" size={18} />Open the simulated inbox
      </Link>
      <div className="spacer" />
      <button className={`btn big ${ready ? "amber" : "off"}`} disabled={!ready} onClick={check}>
        <span className={`pm ${ready ? "dark" : "dark"}`} style={{ opacity: ready ? 1 : 0.5 }}><i /><i /></span>
        Check this message
      </button>
      <p className="sm center-text">{ready ? "Takes about 2 seconds. Nothing is paid or sent." : "Paste or pick a message first."}</p>
    </Screen>
  );
}
