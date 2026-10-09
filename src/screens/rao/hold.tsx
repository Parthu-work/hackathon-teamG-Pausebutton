"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { clockTime, LoadingScreen, Marks, Ring, Screen, useCall, useCountdown } from "@/components/ui";
import { rupees } from "@/lib/check/copy";
import { api, post } from "@/lib/client/api";
import type { HoldView } from "@/lib/views";
import { useHelper } from "./shell";

/** H1 waiting · H2 advice · H3 blocked · H4 approved · H5 expired */
export function HoldScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const call = useCall();
  const helper = useHelper();
  const q = useQuery({
    queryKey: ["hold", id],
    queryFn: () => api<{ hold: HoldView; serverNow: string }>(`/api/me/holds/${id}`),
    refetchInterval: 2000,
  });
  const hold = q.data?.hold;
  const clock = useCountdown(hold?.expiresAt, q.data?.serverNow);

  // Seeing the outcome once is enough; the shell stops jumping here after this.
  const seen = useRef(false);
  useEffect(() => {
    if (!hold || seen.current || hold.outcomeSeen) return;
    if (hold.status === "blocked" || hold.status === "approved") {
      seen.current = true;
      void post(`/api/me/holds/${id}/seen`).then(() => queryClient.invalidateQueries({ queryKey: ["rao-state"] }));
    }
  }, [hold, id, queryClient]);

  if (!hold) return <LoadingScreen />;
  const status = hold.status === "pending" && clock.expired ? "expired" : hold.status;
  const amount = rupees(hold.amount);
  const decider = hold.decidedByName ?? helper.first;
  const home = () => router.push("/");

  if (status === "blocked" || status === "cancelled") {
    const byMe = status === "cancelled";
    return (
      <Screen tone="green" center bodyStyle={{ gap: 20, color: "#fff" }}>
        <span className="circle" style={{ width: 112, height: 112, background: "#fff", color: "#1F6B49" }}><Icon name="check" size={56} /></span>
        <h1 className="h1" style={{ color: "#fff", fontSize: 38 }}>Payment cancelled</h1>
        <p className="p" style={{ fontSize: 22, lineHeight: 1.35 }}>
          {byMe ? <>You cancelled it.<br />Nothing was paid.<br />The savings stay.</> : <>{decider} blocked it.<br />The family called.<br />The savings stay.</>}
        </p>
        {hold.advice[0] && (
          <div className="card" style={{ width: "100%", textAlign: "left" }}>
            <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{hold.advice[0].fromName} says</b></div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>“{hold.advice[0].text}”</p>
          </div>
        )}
        <div className="card" style={{ width: "100%", textAlign: "left" }}>
          <b style={{ fontSize: 18 }}>{amount} stayed in your account</b>
          <p className="sm">{byMe ? "Cancelled by you" : `Blocked by ${decider}`}{hold.decidedAt ? ` at ${clockTime(hold.decidedAt)}` : ""}</p>
        </div>
        <div style={{ height: 8 }} />
        <button className="btn white" onClick={home}>Back to home</button>
      </Screen>
    );
  }

  if (status === "approved") {
    return (
      <Screen>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <span className="circle" style={{ width: 96, height: 96, background: "var(--ink)", color: "#fff" }}><Icon name="personCheck" size={48} /></span>
        </div>
        <h1 className="h1 center-text">{decider} approved this payment</h1>
        <p className="p center-text">They looked at your message and said it is OK. The demo payment of {amount} has been released.</p>
        <div className="card tint-amber">
          <b style={{ fontSize: 17 }}>Still not sure?</b>
          <p className="sm" style={{ color: "var(--text)" }}>
            If anyone has asked you to keep this secret from family, that is a scam sign. Call {decider} again.
          </p>
        </div>
        <div className="spacer" />
        <button className="btn ink" onClick={home}>Done</button>
        <button className="btn line" onClick={() => call(decider)}>Call {decider}</button>
      </Screen>
    );
  }

  if (status === "expired") {
    return (
      <Screen tone="amber-tint">
        <div className="row"><Icon name="clock" /><span className="lbl" style={{ color: "var(--text)" }}>Time is up</span></div>
        <h1 className="h1">Your money is still on hold.</h1>
        <p className="p">Nobody answered in 10 minutes. We keep the payment on hold to keep you safe. Nothing has been paid.</p>
        <div className="card tint-red">
          <b style={{ fontSize: 17 }}>Still being told to keep this secret?</b>
          <p className="sm" style={{ color: "var(--text)" }}>That is a scam sign. Hang up and call the cyber helpline.</p>
        </div>
        <div className="spacer" />
        <button className="btn red" onClick={() => call("1930")}>Call cyber helpline 1930</button>
        <button className="btn ink" onClick={() => call(helper.first)}>Call {helper.first}</button>
        <button className="btn line" onClick={home}>Start again</button>
      </Screen>
    );
  }

  // pending: H1 (waiting) or H2 (advice arrived)
  const advice = hold.advice[0];
  return (
    <Screen tone="amber">
      <div className="row"><Icon name="lock" /><span className="lbl" style={{ color: "#14202B" }}>Payment paused</span></div>
      <Ring fraction={clock.fraction} label={clock.label} sub="minutes left" />
      <h1 className="h2 center-text">{amount} is on hold. Nothing has been paid.</h1>
      <div className="card">
        <div className="lbl">What {helper.first} was told</div>
        <Marks phrases={hold.phrases} />
      </div>
      {advice ? (
        <div className="card tint-green" style={{ border: "2px solid #2E7D5B", padding: "12px 16px", gap: 6 }}>
          <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{advice.fromName} says</b></div>
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{advice.text}”</p>
        </div>
      ) : (
        <div className="card row-card" style={{ padding: "12px 16px" }}>
          <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)", width: 14, height: 14 }} />
          <div className="grow">
            <b style={{ fontSize: 18 }}>Waiting for your family…</b>
            <p className="sm" style={{ color: "var(--text)" }}>{helper.all.length ? `${helper.all.join(" and ")} ${helper.all.length > 1 ? "were" : "was"} alerted.` : "Add a trusted person in Settings."}</p>
          </div>
        </div>
      )}
      <div className="spacer" />
      <button className="btn ink" onClick={() => call(helper.first)}><Icon name="phone" />Call {helper.first}</button>
      <button className="btn line" onClick={() => call("1930")}>Call cyber helpline 1930</button>
      <p className="sm center-text" style={{ color: "#14202B" }}>There is no pay button here. This screen opens when {helper.first} decides.</p>
    </Screen>
  );
}
