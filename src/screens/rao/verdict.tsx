"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, LoadingScreen, Screen, SignalBars, SignalRows, useCall, useCountdown, useToast, VerdictPill } from "@/components/ui";
import { rupees } from "@/lib/check/copy";
import { api, post } from "@/lib/client/api";
import type { CheckView } from "@/lib/views";
import { useHelper } from "./shell";

export function useCheck(id: string) {
  return useQuery({ queryKey: ["check", id], queryFn: () => api<CheckView>(`/api/me/checks/${id}`), refetchInterval: 3000 });
}

const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);

/** E1 · SCAM · E2 · SUSPICIOUS · E3 · SAFE · N3 · detected message detail */
export function VerdictScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const call = useCall();
  const toast = useToast();
  const helper = useHelper();
  const { data: c, error } = useCheck(id);
  const [dismissed, setDismissed] = useState(false);
  const holdClock = useCountdown(c?.hold?.status === "pending" ? c.hold.expiresAt : undefined);

  if (error) {
    return (
      <Screen>
        <h1 className="h1">We could not open this check</h1>
        <p className="p">{error.message}</p>
        <button className="btn ink" onClick={() => router.push("/")}>Back to home</button>
      </Screen>
    );
  }
  if (!c) return <LoadingScreen />;

  const detected = c.source !== "paste";
  const asked = !!c.askedFamilyAt;
  const alerted = c.alertedNames.length > 0;

  async function ask() {
    await post(`/api/me/checks/${id}/ask`);
    await queryClient.invalidateQueries({ queryKey: ["check", id] });
    toast({ title: `${helper.first} has been asked`, sub: "Their answer will show here", icon: "bell" });
  }

  const familyAnswer = c.familyVerdict && (
    <div className={`card ${c.familyVerdict === "not_scam" ? "tint-green" : "tint-red"}`} style={{ border: `2px solid ${c.familyVerdict === "not_scam" ? "#2E7D5B" : "#C6372B"}` }}>
      <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{c.familyVerdictByName ?? helper.first} says</b></div>
      <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>
        {c.familyVerdict === "not_scam" ? "This is not a scam. You can carry on." : "This is a scam. Do not pay or reply."}
      </p>
      {c.advice[0] && <p className="sm" style={{ color: "var(--text)" }}>“{c.advice[0].text}”</p>}
    </div>
  );

  const adviceCard = !c.familyVerdict && c.advice[0] && (
    <div className="card tint-green" style={{ border: "2px solid #2E7D5B" }}>
      <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{c.advice[0].fromName} says</b></div>
      <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{c.advice[0].text}”</p>
    </div>
  );

  const sourceRow = detected && (
    <div className="card row-card" style={{ padding: "10px 14px" }}>
      <span className="src"><Icon name="msg" /></span>
      <div className="grow">
        <div className="lbl">Detected on this phone</div>
        <b style={{ fontSize: 16 }}>{c.source === "sms" ? "SMS" : "WhatsApp"} · {c.senderLabel}</b>
      </div>
      <span className="sm">{clockTime(c.createdAt)}</span>
    </div>
  );

  const degradedNote = c.degraded && (
    <div className="note" style={{ margin: "0 0 4px" }}><Icon name="info" />Checked by rules only — AI unavailable</div>
  );

  const top = (
    <>
      {degradedNote}
      <button className="back" onClick={() => router.push(detected ? "/inbox" : "/")}>
        <Icon name="back" />
        <span>{detected ? "Back to messages" : "Check another message"}</span>
      </button>
      {sourceRow}
    </>
  );

  // ---------- SCAM ----------
  if (c.verdict === "SCAM") {
    const headline = detected ? "Do not reply. Do not click." : c.headline;
    const body = detected
      ? c.body
      : `${c.body}${alerted ? " We have already told your family for you." : ""}`;
    return (
      <Screen>
        {top}
        <VerdictPill verdict="SCAM" />
        <h1 className="h1">{headline}</h1>
        <p className="p">{body}</p>
        <div className="lbl">What the message does</div>
        <SignalBars signals={c.signals} />
        <SignalRows signals={c.signals} link={c.link} modelTerms={c.modelTerms} />
        {familyAnswer}
        {adviceCard}
        {c.hold && c.hold.status === "pending" && (
          <Link href={`/hold/${c.hold.id}`} className="card row-card tint-amber" style={{ textDecoration: "none" }}>
            <Icon name="lock" />
            <div className="grow">
              <b style={{ fontSize: 17 }}>{rupees(c.hold.amount)} payment paused</b>
              <p className="sm" style={{ color: "var(--text)" }}>{holdClock.label} left. Nothing has been paid.</p>
            </div>
            <Icon name="chev" />
          </Link>
        )}
        {alerted && (
          <div className="card row-card tint-green">
            <span className="circle" style={{ width: 34, height: 34, background: "#2E7D5B", color: "#fff" }}><Icon name="check" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: 17 }}>{names(c.alertedNames)} {c.alertedNames.length > 1 ? "were" : "was"} {detected ? "told" : "alerted"}</b>
              <p className="sm" style={{ color: "var(--text)" }}>
                Sent automatically at {clockTime(c.createdAt)}. Do nothing until they reply.
              </p>
            </div>
          </div>
        )}
        <div className="spacer" />
        {detected ? (
          <button className="btn ink" onClick={() => call(helper.first)}><Icon name="phone" />Call {helper.first}</button>
        ) : (
          <button className="btn amber" onClick={() => router.push(`/check/${id}/todo`)}>What to do now</button>
        )}
        <button className="btn line" onClick={() => router.push(`/check/${id}/why`)}>Why we think so</button>
        {!alerted && !asked && <button className="btn line" onClick={ask}><Icon name="bell" />Tell {helper.first}</button>}
        <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
          <button className="ghost" onClick={() => call("1930")}>Call cyber helpline 1930</button>
          {c.amount && (!c.hold || c.hold.status === "cancelled") && (
            <button className="ghost" onClick={() => router.push(`/check/${id}/pay`)}>Pay anyway (demo)</button>
          )}
          {detected && !dismissed && (
            <button className="ghost" onClick={() => { setDismissed(true); toast({ title: "Noted", sub: `If you are not sure, ask ${helper.first}.`, icon: "info" }); }}>
              This is not a scam
            </button>
          )}
        </div>
      </Screen>
    );
  }

  // ---------- SUSPICIOUS ----------
  if (c.verdict === "SUSPICIOUS") {
    return (
      <Screen>
        {top}
        <VerdictPill verdict="SUSPICIOUS" />
        <h1 className="h1">{c.headline}</h1>
        <p className="p">{c.body}</p>
        <div className="lbl">What the message does</div>
        <SignalBars signals={c.signals} amber />
        <SignalRows signals={c.signals} link={c.link} modelTerms={c.modelTerms} />
        {familyAnswer}
        {adviceCard}
        {asked && !c.familyVerdict && (
          <div className="card row-card" style={{ padding: "12px 16px" }}>
            <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)", width: 14, height: 14 }} />
            <div className="grow">
              <b style={{ fontSize: 18 }}>Waiting for {helper.first}…</b>
              <p className="sm" style={{ color: "var(--text)" }}>Asked at {clockTime(c.askedFamilyAt!)}. Their answer will show here.</p>
            </div>
          </div>
        )}
        <div className="spacer" />
        {c.familyVerdict === "not_scam" ? (
          <button className="btn green" onClick={() => router.push("/")}>Done</button>
        ) : asked ? (
          <button className="btn ink" onClick={() => call(helper.first)}><Icon name="phone" />Call {helper.first}</button>
        ) : (
          <button className="btn ink" onClick={ask}><Icon name="bell" />Ask {helper.first}</button>
        )}
        <button className="btn line" onClick={() => router.push(`/check/${id}/why`)}>Why we think so</button>
        <p className="sm center-text">Do not tap the link or pay until {helper.first} replies.</p>
        {c.amount && c.familyVerdict !== "not_scam" && (!c.hold || c.hold.status === "cancelled") && (
          <button className="ghost" style={{ alignSelf: "center" }} onClick={() => router.push(`/check/${id}/pay`)}>Pay anyway (demo)</button>
        )}
      </Screen>
    );
  }

  // ---------- SAFE ----------
  return (
    <Screen>
      {top}
      <VerdictPill verdict="SAFE" />
      <h1 className="h1">{c.headline}</h1>
      <p className="p">{c.body}</p>
      <div className="lbl">What the message does</div>
      <SignalBars signals={c.signals} />
      <SignalRows signals={c.signals} link={c.link} />
      {familyAnswer}
      <div className="card tint-green">
        <p className="sm" style={{ color: "var(--text)" }}>
          Safe means we found no warning signs. Never share your OTP or PIN with anyone, even if a message looks real.
        </p>
      </div>
      <div className="spacer" />
      <button className="btn green" onClick={() => router.push(detected ? "/inbox" : "/")}>Done</button>
      {!asked ? (
        <button className="btn line" onClick={ask}>Ask {helper.first} anyway</button>
      ) : (
        !c.familyVerdict && <p className="sm center-text">{helper.first} has been asked.</p>
      )}
    </Screen>
  );
}

/** G1 · STOP: strict notice shown first when a SCAM is found */
export function StopScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const call = useCall();
  const helper = useHelper();
  const { data: c } = useCheck(id);
  const alerted = c?.alertedNames ?? [];
  const items: [string, "x" | "link" | "phone" | "shield"][] = [
    ["Do not pay or send money", "x"],
    ["Do not tap any link", "link"],
    ["Do not call back or stay on the call", "phone"],
    ["Do not share OTP, PIN or card number", "shield"],
  ];
  return (
    <Screen tone="red" bodyStyle={{ color: "#fff", gap: 10 }}>
      <span className="lbl center-text" style={{ color: "#fff", fontSize: 14 }}>Scam message detected</span>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span className="circle" style={{ width: 92, height: 92, background: "#fff", color: "#B3291E" }}>
          <Icon name="octagon" size={48} />
        </span>
      </div>
      <h1 className="h1 center-text" style={{ color: "#fff", fontSize: 46 }}>STOP</h1>
      <p className="p center-text" style={{ color: "#fff", fontSize: 21, fontWeight: 800, lineHeight: 1.25 }}>
        Do not do anything this message asks.
      </p>
      {items.map(([label, icon]) => (
        <div key={label} className="row" style={{ background: "rgba(255,255,255,.14)", borderRadius: 14, padding: "12px 14px" }}>
          <span className="circle" style={{ width: 34, height: 34, background: "#fff", color: "#B3291E" }}><Icon name={icon} size={20} /></span>
          <b style={{ fontSize: 19, lineHeight: 1.2, color: "#fff" }}>{label}</b>
        </div>
      ))}
      <p className="sm center-text" style={{ color: "#fff", fontSize: 15 }}>
        {alerted.length
          ? `${names(alerted)} ${alerted.length > 1 ? "have" : "has"} been told. They will reply with what to do.`
          : "Call someone you trust before you do anything."}
      </p>
      <div className="spacer" />
      <button className="btn white" onClick={() => router.replace(`/check/${id}`)}>I will not do anything</button>
      <button className="btn whiteline md-btn" onClick={() => call(helper.first)}><Icon name="phone" />Call {helper.first}</button>
    </Screen>
  );
}
