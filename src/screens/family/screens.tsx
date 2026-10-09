"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  Avatar, clockTime, FamilyTabs, LoadingScreen, Marks, Screen, Sheet, StatusPill, TitleRow, Toggle,
  useCall, useCountdown, useToast, VerdictPill,
} from "@/components/ui";
import { ADVICE_PRESETS, rupees, whatToSay } from "@/lib/check/copy";
import { playAlarm, unlockAudio } from "@/lib/client/alarm";
import { api, operatorApi, post } from "@/lib/client/api";
import type { ActivityItem, CheckView, EventView, HoldView } from "@/lib/views";
import { useCallName, useFamily } from "./shell";

// ---------------- C1 / Q4 · accept invite ----------------

export function JoinScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(search.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const clean = code.trim().toUpperCase();
  const preview = useQuery({
    queryKey: ["invite", clean],
    queryFn: () => api<{ invite: { protectedName: string } | null }>(`/api/family/invite?code=${encodeURIComponent(clean)}`),
    enabled: clean.replace(/[^A-Z0-9]/g, "").length >= 6,
  });
  const who = preview.data?.invite?.protectedName;
  const codeFailed = error?.startsWith("That code did not work") ?? true;

  async function accept() {
    setError(null);
    try {
      await post("/api/family/join", { code: clean });
      await queryClient.invalidateQueries({ queryKey: ["family-state"] });
      router.push("/family/alerts-setup");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function notNow() {
    await post("/api/auth/sign-out", { app: "family" });
    router.push("/welcome");
  }

  return (
    <Screen bodyStyle={{ alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        {who ? <Avatar name={who} size={88} /> : <span className="circle" style={{ width: 88, height: 88, background: "var(--chip)" }}><Icon name="people" size={40} /></span>}
      </div>
      <h1 className="h1 center-text">{who ? `${who} wants you as a trusted person` : "Enter your invite code"}</h1>
      <p className="p center-text">
        {who ? "If a message looks like a scam, or they are about to pay, you get an alert. Then you decide." : "Type the code you were sent. It looks like PB-4K7Q."}
      </p>
      <label>
        <div className="lbl">Invite code</div>
        <div className={`in mono ${error ? "err" : ""}`} style={{ marginTop: 6, fontSize: 24, textAlign: "center", gap: 10 }}>
          <input aria-label="Invite code" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} placeholder="PB-____" autoCapitalize="characters" style={{ textAlign: "center" }} />
          {error && <span style={{ color: "var(--red-text)" }}><Icon name="x" /></span>}
        </div>
        {error && (
          <>
            <div className="row" style={{ gap: 8, marginTop: 8, color: "var(--red-text)", fontWeight: 700, fontSize: 15 }}><Icon name="warn" size={20} />{codeFailed ? "That code did not work" : "We could not link you"}</div>
            <p className="sm" style={{ marginTop: 4 }}>{codeFailed ? "Check each letter. Each code works once and ends in 24 hours." : error}</p>
          </>
        )}
      </label>
      <button className={`btn ${clean.length >= 6 ? "green" : "off"}`} disabled={clean.length < 6} onClick={accept}>Accept</button>
      <button className="ghost" style={{ alignSelf: "center" }} onClick={notNow}>Not now</button>
      <div className="spacer" />
      <p className="sm center-text">You see only what they check with Pause Button.</p>
    </Screen>
  );
}

// ---------------- C2 · enable alerts + test buzz ----------------

function AlertToggles() {
  const { data } = useFamily();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, boolean>) => api("/api/family/settings", { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["family-state"] }),
  });
  if (!data) return null;
  const rows: [string, string, "alertNotify" | "alertSound" | "alertVibrate"][] = [
    ["Notifications", "Show alerts, even on the lock screen.", "alertNotify"],
    ["Sound", "A loud tone you cannot miss.", "alertSound"],
    ["Vibrate and flash", "Buzz and flash the screen.", "alertVibrate"],
  ];
  return (
    <>
      {rows.map(([title, sub, key]) => (
        <div className="row" key={key}>
          <div className="grow"><div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div><p className="sm">{sub}</p></div>
          <Toggle on={data.me[key]} label={title} onChange={(v) => save.mutate({ [key]: v })} />
        </div>
      ))}
    </>
  );
}

function useTestAlert() {
  const { data } = useFamily();
  const toast = useToast();
  return () => {
    unlockAudio();
    playAlarm("urgent", { sound: data?.me.alertSound ?? true, vibrate: data?.me.alertVibrate ?? true });
    toast({ title: "Test alert sent", sub: "This is how a scam alert feels", icon: "bell" });
  };
}

export function AlertsSetupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const test = useTestAlert();
  async function done() {
    await api("/api/family/settings", { method: "PATCH", body: { alertsReady: true } });
    await queryClient.invalidateQueries({ queryKey: ["family-state"] });
    router.push("/family");
  }
  return (
    <Screen>
      <p className="lbl">Last step</p>
      <h1 className="h1">So we can reach you fast</h1>
      <p className="p">Turn these on. An alert has to get your attention.</p>
      <div className="card" style={{ gap: 16 }}><AlertToggles /></div>
      <div className="card tint-amber">
        <p className="sm" style={{ color: "var(--text)" }}>On iPhone, websites cannot vibrate. We flash the screen and play the sound instead.</p>
      </div>
      <button className="btn line" onClick={test}><Icon name="bell" />Send me a test alert</button>
      <div className="spacer" />
      <button className="btn amber" onClick={done}>Done</button>
    </Screen>
  );
}

// ---------------- C3 / J1 · family home ----------------

export function FamilyHomeScreen() {
  const router = useRouter();
  const callName = useCallName();
  const { data } = useFamily();
  const hold = data?.activeHold ?? null;
  const clock = useCountdown(hold?.expiresAt, data?.serverNow);
  if (!data?.protectedUser) return <LoadingScreen />;
  const p = data.protectedUser;
  // Questions, heads-ups, and scam alerts with no payment to block (e.g. a fake KYC link).
  const openItems = data.alerts.filter((a) => a.kind !== "urgent" || !a.holdId);

  return (
    <Screen tabs={<FamilyTabs active="home" callName={callName} />}>
      <div className="row">
        <Avatar name={p.name} />
        <div className="grow">
          <div className="h2" style={{ fontSize: 22 }}>{p.name}{callName !== p.name ? ` (${callName})` : ""}</div>
          <p className="sm">Linked · phone {p.online ? "online" : "offline"}</p>
        </div>
        <span className="tag g">LINKED</span>
      </div>

      {hold && !clock.expired && (
        <div className="card solid-red" style={{ gap: 10, padding: 18 }}>
          <span className="lbl" style={{ color: "#fff" }}>Action needed</span>
          <h2 className="h2" style={{ color: "#fff", fontSize: 28 }}>{rupees(hold.amount)} payment paused</h2>
          <p className="p" style={{ fontSize: 16 }}>{clock.label} left to decide. {callName} is waiting.</p>
          <button className="btn white" style={{ minHeight: 56 }} onClick={() => router.push(`/family/hold/${hold.id}`)}>Open</button>
        </div>
      )}
      {hold && clock.expired && (
        <div className="card tint-amber" style={{ gap: 10 }}>
          <span className="lbl" style={{ color: "var(--text)" }}>Time is up</span>
          <h2 className="h2">{rupees(hold.amount)} still on hold</h2>
          <p className="p" style={{ fontSize: 16 }}>Nobody decided in 10 minutes. Block still works.</p>
          <button className="btn ink" style={{ minHeight: 56 }} onClick={() => router.push(`/family/hold/${hold.id}`)}>Open</button>
        </div>
      )}
      {openItems.map((a) => (
        <button key={a.id} className={`card ${a.kind === "urgent" ? "tint-red" : "tint-amber"}`} onClick={() => router.push(`/family/check/${a.checkId}?alert=${a.id}`)}>
          <div className="row">
            <Icon name="bell" />
            <b className="grow" style={{ fontSize: 17 }}>
              {a.kind === "ask"
                ? `${callName} is asking you about a message`
                : a.kind === "urgent"
                  ? `${callName} got a scam message`
                  : `Heads-up: ${callName} got a ${a.verdict.toLowerCase()} message`}
            </b>
            <Icon name="chev" />
          </div>
          <Marks phrases={a.phrases} size={15} />
        </button>
      ))}
      {!hold && !openItems.length && (
        <div className="card tint-green" style={{ alignItems: "flex-start", padding: 22, gap: 10 }}>
          <span style={{ color: "var(--green-text)" }}><Icon name="shieldCheck" size={32} /></span>
          <h2 className="h2">{callName} is protected</h2>
          <p className="p">No payments are paused. {data.today.total ? `${data.today.total} checked today.` : "No checks yet today."}</p>
        </div>
      )}
      {data.lastCheck && (
        <button className="card" onClick={() => router.push(`/family/check/${data.lastCheck!.id}`)}>
          <div className="lbl">Last check</div>
          <div className="row"><VerdictPill verdict={data.lastCheck.verdict} size="small" icon={false} /><span className="sm grow">{clockTime(data.lastCheck.createdAt)} · {data.lastCheck.title}</span></div>
          <Marks phrases={data.lastCheck.phrases} size={16} />
        </button>
      )}
      {data.today.total > 0 ? (
        <div className="card">
          <div className="lbl">Today</div>
          <div className="row">
            <b className="grow" style={{ fontSize: 20 }}>{data.today.total} message{data.today.total === 1 ? "" : "s"} checked</b>
            <span className="sm">{data.today.scam} scam · {data.today.suspicious} suspicious · {data.today.safe} safe</span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="lbl">How you will be alerted</div>
          <div className="row"><Icon name="bell" /><span className="p" style={{ fontSize: 17 }}>Buzz, flash and sound</span></div>
          <div className="row"><Icon name="check" /><span className="p" style={{ fontSize: 17 }}>You see what {callName} was told</span></div>
          <div className="row"><Icon name="phone" /><span className="p" style={{ fontSize: 17 }}>One tap to call {callName}</span></div>
        </div>
      )}
      <div className="spacer" />
      <p className="sm center-text">Keep this app open or installed on your home screen.</p>
    </Screen>
  );
}

// ---------------- I1 / O1 · full-screen alert ----------------

export function AlertScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const callName = useCallName();
  const { data } = useFamily();
  const alert = data?.alerts.find((a) => a.id === id);
  useEffect(() => {
    if (data && !alert) router.replace("/family");
  }, [data, alert, router]);
  if (!alert) return <LoadingScreen />;

  async function open() {
    await post(`/api/family/alerts/${id}/opened`).catch(() => {});
    router.push(alert!.holdId ? `/family/hold/${alert!.holdId}` : `/family/check/${alert!.checkId}?alert=${id}`);
  }
  const others = alert.otherRecipients;

  if (alert.kind === "urgent") {
    return (
      <Screen tone="red" center bodyStyle={{ color: "#fff", gap: 18, justifyContent: "flex-start" }}>
        <span className="lbl" style={{ color: "#fff", fontSize: 15, marginTop: 20 }}>{callName} needs you now</span>
        <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center", margin: "6px 0" }}>
          <span className="pulse-ring" style={{ inset: 0, border: "3px solid rgba(255,255,255,.35)" }} />
          <span className="pulse-ring" style={{ inset: 26, border: "3px solid rgba(255,255,255,.6)", animationDelay: ".6s" }} />
          <span className="circle" style={{ width: 96, height: 96, background: "#fff", color: "#B3291E" }}><Icon name="bell" size={44} /></span>
        </div>
        <h1 className="h1" style={{ color: "#fff", fontSize: 40 }}>{callName} got a scam message</h1>
        <p className="p" style={{ fontSize: 20 }}>
          {alert.amount ? `It asks for ${rupees(alert.amount)}. Nothing is paid. ` : "Nothing is paid. "}Tell them what to do.
        </p>
        <span className="pill medium" style={{ background: "#fff", color: "#14202B", alignSelf: "center" }}>
          {others.length ? `Sent to you and ${others.join(" and ")}` : "Sent to you"}
        </span>
        <div className="spacer" />
        <button className="btn white" style={{ minHeight: 68, fontSize: 24 }} onClick={open}>Open</button>
        <p className="sm" style={{ color: "#fff" }}>Buzz · flash · sound. {clockTime(alert.createdAt)}</p>
      </Screen>
    );
  }

  return (
    <Screen tone="amber" center bodyStyle={{ gap: 18, justifyContent: "flex-start" }}>
      <span className="lbl" style={{ color: "#14202B", fontSize: 15, marginTop: 20 }}>{alert.kind === "ask" ? `${callName} is asking you` : "Heads-up"}</span>
      <span className="circle" style={{ width: 96, height: 96, background: "#fff", color: "#14202B" }}><Icon name="bell" size={44} /></span>
      <h1 className="h1" style={{ fontSize: 34 }}>
        {alert.kind === "ask" ? `Is this message safe?` : `${callName} got a ${alert.verdict === "SCAM" ? "scam" : "suspicious"} message`}
      </h1>
      <p className="p">
        {alert.source === "paste" ? "Checked with Pause Button" : `${alert.source === "sms" ? "SMS" : "WhatsApp"} · ${clockTime(alert.createdAt)}`}.{" "}
        {alert.kind === "ask" ? "They are waiting for your answer." : "They have not tried to pay."}
      </p>
      <Marks phrases={alert.phrases} />
      <div className="spacer" />
      <button className="btn ink" style={{ minHeight: 64 }} onClick={open}>Open</button>
      <p className="sm" style={{ color: "#14202B" }}>Quiet alert: a short sound and buzz.</p>
    </Screen>
  );
}

// ---------------- I2 / I3 / I4 / J2 · payment decision ----------------

export function FamilyHoldScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const callName = useCallName();
  const call = useCall();
  const toast = useToast();
  const { data: fam } = useFamily();
  const q = useQuery({
    queryKey: ["family-hold", id],
    queryFn: () => api<{ hold: HoldView; timeline: EventView[]; serverNow: string }>(`/api/family/holds/${id}`),
    refetchInterval: 2000,
  });
  const [advice, setAdvice] = useState(ADVICE_PRESETS[0]);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = q.data?.hold;
  const clock = useCountdown(hold?.expiresAt, q.data?.serverNow);

  // Opening the hold counts as opening its alert ("status seen").
  const opened = useRef(false);
  useEffect(() => {
    const a = fam?.alerts.find((x) => x.holdId === id && !x.openedAt);
    if (a && !opened.current) {
      opened.current = true;
      void post(`/api/family/alerts/${a.id}/opened`);
    }
  }, [fam, id]);

  const decide = useMutation({
    mutationFn: (decision: "block" | "approve") => post(`/api/family/holds/${id}/decision`, { decision, confirm: decision === "approve" }),
    onSuccess: async (_d, decision) => {
      setConfirm(false);
      await queryClient.invalidateQueries();
      toast({ title: decision === "block" ? "Payment blocked" : "Payment approved", sub: `${callName}'s screen shows it now`, icon: decision === "block" ? "check" : "personCheck" });
    },
    onError: async (e) => {
      setConfirm(false);
      setError(e.message);
      await queryClient.invalidateQueries();
    },
  });

  async function sendAdvice() {
    await post(`/api/family/holds/${id}/advice`, { text: advice });
    await queryClient.invalidateQueries({ queryKey: ["family-hold", id] });
    toast({ title: `Advice sent to ${callName}`, sub: "They can see it now", icon: "bell" });
    call(callName);
  }

  if (!hold) return <LoadingScreen />;
  const status = hold.status === "pending" && clock.expired ? "expired" : hold.status;
  const amount = rupees(hold.amount);

  if (status === "blocked" || status === "approved" || status === "cancelled") {
    const me = fam?.me.name;
    const byMe = hold.decidedByName === me;
    const verb = status === "blocked" ? "blocked" : status === "approved" ? "approved" : "cancelled";
    const title = status === "cancelled" ? `${callName} cancelled it` : byMe ? `You ${verb} it` : `${hold.decidedByName} ${verb} it`;
    const dot = (type: string) => (type === "alert" || type === "hold" ? "#C6372B" : type === "opened" || type === "advice" ? "#F2A900" : "#2E7D5B");
    const timeline = (q.data?.timeline ?? []).filter((e) => ["hold", "alert", "opened", "advice", "blocked", "approved", "cancelled", "pay_attempt"].includes(e.type));
    return (
      <Screen>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <span className="circle" style={{ width: 96, height: 96, background: status === "approved" ? "var(--ink)" : "#2E7D5B", color: "#fff" }}>
            <Icon name={status === "approved" ? "personCheck" : "check"} size={48} />
          </span>
        </div>
        <h1 className="h1 center-text">{title}</h1>
        <p className="p center-text">
          {callName}&apos;s screen now says: {status === "approved" ? `Payment released (demo).` : "Payment cancelled"}
          {hold.advice.length ? ", with your advice." : "."}
        </p>
        <div className="card" style={{ gap: 12 }}>
          <div className="lbl">What happened</div>
          {timeline.map((e) => (
            <div className="row" key={e.id}>
              <span className="dot" style={{ background: dot(e.type) }} />
              <span className="grow" style={{ fontSize: 15 }}>{e.message}</span>
              <span className="sm">{clockTime(e.createdAt)}</span>
            </div>
          ))}
        </div>
        {status !== "approved" && (
          <div className="card tint-amber">
            <b style={{ fontSize: 17 }}>Next</b>
            <p className="sm" style={{ color: "var(--text)" }}>
              Call {callName} and stay with them while they check their bank app. Tell them not to answer that caller again.
            </p>
          </div>
        )}
        <div className="spacer" />
        <button className="btn green" onClick={() => call(callName)}><Icon name="phone" />Call {callName}</button>
        <button className="btn line" onClick={() => router.push("/family")}>Back to home</button>
      </Screen>
    );
  }

  const told = (
    <div className="card">
      <div className="lbl">What {callName} was told</div>
      <Marks phrases={hold.phrases} />
      {hold.verdict === "SCAM" && <p className="sm">Scammers often ask for secrecy and money together. That is always a scam.</p>}
    </div>
  );

  if (status === "expired") {
    return (
      <Screen>
        <TitleRow title={`${callName}'s payment`} back="/family" right={<span className="pill medium amber">EXPIRED</span>} />
        <div className="card tint-amber" style={{ gap: 6 }}>
          <h2 className="h2">Time is up. Nothing was paid.</h2>
          <p className="p" style={{ fontSize: 16 }}>
            Nobody decided in 10 minutes, so {callName}&apos;s money is still on hold. {callName} has been told to call you or the helpline.
          </p>
        </div>
        {told}
        {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
        <div className="spacer" />
        <button className="btn green" style={{ minHeight: 64 }} onClick={() => call(callName)}><Icon name="phone" />Call {callName}</button>
        <button className="btn red" style={{ minHeight: 64 }} onClick={() => decide.mutate("block")}>Block this payment</button>
      </Screen>
    );
  }

  return (
    <Screen overlay={confirm && <ApproveSheet hold={hold} callName={callName} onKeep={() => setConfirm(false)} onApprove={() => decide.mutate("approve")} />}>
      <TitleRow title={`${callName}'s payment`} back="/family" right={<span className="pill medium ink">{clock.label}</span>} />
      <div className="row"><VerdictPill verdict={hold.verdict} size="medium" icon={false} /><span style={{ fontWeight: 800, fontSize: 18 }}>{amount} paused</span></div>
      {told}
      <div className="card" style={{ border: "2px solid var(--text)", gap: 10 }}>
        <div className="lbl" style={{ color: "var(--text)" }}>Tell {callName} what to do</div>
        {ADVICE_PRESETS.map((a) => (
          <button key={a} className="row" style={{ gap: 12, alignItems: "flex-start", minHeight: 44, background: "transparent", textAlign: "left", padding: 0, color: "inherit" }} onClick={() => setAdvice(a)}>
            <span className={`rad ${advice === a ? "on" : ""}`} />
            <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{a}</span>
          </button>
        ))}
        {hold.advice[0] && <p className="sm">Sent: “{hold.advice[0].text}” ({hold.advice[0].fromName}, {clockTime(hold.advice[0].createdAt)})</p>}
      </div>
      <p className="sm">
        {fam?.alerts.find((a) => a.holdId === id)?.otherRecipients.length
          ? `Also alerted: ${fam.alerts.find((a) => a.holdId === id)!.otherRecipients.join(", ")}. `
          : ""}
        Your advice shows on {callName}&apos;s screen.
      </p>
      {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
      <div className="spacer" />
      <button className="btn green" style={{ minHeight: 64 }} onClick={sendAdvice}><Icon name="phone" />Send advice and call {callName}</button>
      <button className="btn red" style={{ minHeight: 64 }} disabled={decide.isPending} onClick={() => decide.mutate("block")}>Block this payment</button>
      <button className="btn line sm-btn" onClick={() => setConfirm(true)}>Approve (I know this payment)</button>
    </Screen>
  );
}

function ApproveSheet({ hold, callName, onKeep, onApprove }: { hold: HoldView; callName: string; onKeep: () => void; onApprove: () => void }) {
  return (
    <Sheet onClose={onKeep}>
      <h2 className="h2">Approve this payment?</h2>
      <p className="p">
        {callName} was warned about {hold.phrases.slice(0, 2).map((p) => `“${p}”`).join(" and ")}. Only approve if you know who they are paying.
      </p>
      <button className="btn red" style={{ minHeight: 64 }} onClick={onKeep}>No, keep it blocked</button>
      <button className="btn line md-btn" onClick={onApprove}>Yes, approve</button>
    </Sheet>
  );
}

// ---------------- O2 · heads-up detail / "Ask Arjun" answer ----------------

export function FamilyCheckScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const callName = useCallName();
  const call = useCall();
  const toast = useToast();
  const { data: fam } = useFamily();
  const q = useQuery({ queryKey: ["family-check", id], queryFn: () => api<CheckView>(`/api/family/checks/${id}`), refetchInterval: 3000 });
  const alertId = search.get("alert");

  useEffect(() => {
    if (alertId) void post(`/api/family/alerts/${alertId}/opened`).catch(() => {});
  }, [alertId]);

  const answer = useMutation({
    mutationFn: (v: { verdict: "scam" | "not_scam"; note?: string }) => post(`/api/family/checks/${id}/verdict`, v),
    onSuccess: async (_d, v) => {
      await queryClient.invalidateQueries();
      toast({ title: v.verdict === "scam" ? "Marked as a scam" : "Marked as not a scam", sub: `${callName} can see your answer`, icon: "check" });
      router.push("/family");
    },
    // Someone else answered first: their answer stands and shows on this screen.
    onError: async (e) => {
      toast({ title: "Already answered", sub: e.message, icon: "warn", tone: "red" });
      await queryClient.invalidateQueries({ queryKey: ["family-check", id] });
    },
  });

  const c = q.data;
  if (!c) return <LoadingScreen />;
  const fromAsk = fam?.alerts.some((a) => a.checkId === id && a.kind === "ask") || (!!c.askedFamilyAt && !c.familyVerdict);
  const urgent = !fromAsk && !!fam?.alerts.some((a) => a.checkId === id && a.kind === "urgent");
  const pending = c.hold && c.hold.status === "pending";

  return (
    <Screen>
      <TitleRow title={fromAsk ? `${callName} is asking` : urgent ? "Scam alert" : "Heads-up"} back="/family" right={<VerdictPill verdict={c.verdict} size="medium" icon={false} />} />
      <p className="sm">
        {c.source === "paste" ? `Checked by ${callName}` : `Detected on ${callName}'s phone · ${c.source === "sms" ? "SMS" : "WhatsApp"} · ${c.senderLabel}`} · {clockTime(c.createdAt)}
      </p>
      <div className="card">
        <div className="lbl">{c.simText ? "What the message said" : `What ${callName} was told`}</div>
        {c.simText ? <p className="p" style={{ fontSize: 16 }}>{c.simText}</p> : null}
        <Marks phrases={[...c.signals.map((s) => s.phrase), ...(c.link && c.link.status !== "known" ? [c.link.domain] : [])].slice(0, 4)} />
        {c.familyTitle && <p className="sm">Looks like {c.familyTitle.toLowerCase()}.</p>}
      </div>
      {pending ? (
        <button className="card solid-red" onClick={() => router.push(`/family/hold/${c.hold!.id}`)}>
          <b style={{ fontSize: 17 }}>{rupees(c.hold!.amount)} payment paused</b>
          <p className="sm" style={{ color: "#fff" }}>Open it to block or approve.</p>
        </button>
      ) : (
        <div className="card">
          <b style={{ fontSize: 17 }}>No payment has been paused</b>
          <p className="sm">If {callName} tries to pay, you get an urgent alert and they cannot continue until you decide.</p>
        </div>
      )}
      {c.familyVerdict ? (
        <div className={`card ${c.familyVerdict === "not_scam" ? "tint-green" : "tint-red"}`}>
          <b style={{ fontSize: 17 }}>{c.familyVerdictByName} said: {c.familyVerdict === "not_scam" ? "not a scam" : "a scam"}</b>
        </div>
      ) : (
        <div className="card">
          <div className="lbl">What to say</div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{whatToSay(c.verdict, callName)}</p>
        </div>
      )}
      <div className="spacer" />
      <button className="btn green" onClick={() => call(callName)}><Icon name="phone" />Call {callName}</button>
      {!c.familyVerdict && (
        <>
          <button className="btn red" onClick={() => answer.mutate({ verdict: "scam", note: "It is a scam. Do not pay or reply." })}>
            {fromAsk || urgent ? "It's a scam" : "Mark as handled"}
          </button>
          <button className="btn line" onClick={() => answer.mutate({ verdict: "not_scam", note: "I checked. This one is fine." })}>This is not a scam</button>
        </>
      )}
    </Screen>
  );
}

// ---------------- J3 · activity ----------------

export function ActivityScreen() {
  const router = useRouter();
  const callName = useCallName();
  const [filter, setFilter] = useState<"all" | "scams" | "safe">("all");
  const q = useQuery({ queryKey: ["family-activity"], queryFn: () => api<ActivityItem[]>("/api/family/activity"), refetchInterval: 4000 });
  const items = (q.data ?? []).filter((i) =>
    filter === "all" ? true : filter === "safe" ? i.label === "SAFE" : i.label !== "SAFE",
  );
  return (
    <Screen tabs={<FamilyTabs active="activity" callName={callName} />}>
      <h1 className="h1">Activity</h1>
      <div className="row" style={{ gap: 8 }}>
        {(["all", "scams", "safe"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
        ))}
      </div>
      {q.isPending && <div className="card"><span className="sk" /></div>}
      {!q.isPending && !items.length && <p className="p" style={{ color: "var(--muted)" }}>Nothing here yet.</p>}
      {items.map((i) => (
        <button key={i.id + i.kind} className="card" onClick={() => router.push(i.kind === "hold" ? `/family/hold/${i.id}` : `/family/check/${i.checkId}`)}>
          <div className="row"><StatusPill label={i.label} /><span className="grow" /><span className="sm">{clockTime(i.createdAt)}</span></div>
          <b style={{ fontSize: 17 }}>{i.title}</b>
          <Marks phrases={i.phrases} size={15} />
        </button>
      ))}
      <div className="spacer" />
      <p className="sm center-text">We keep only the warning phrases, not full messages.</p>
    </Screen>
  );
}

// ---------------- J4 · settings, test alert, demo reset ----------------

export function FamilySettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const callName = useCallName();
  const toast = useToast();
  const test = useTestAlert();
  const { data } = useFamily();
  const [unlinking, setUnlinking] = useState(false);
  const p = data?.protectedUser;

  async function reset() {
    await operatorApi("/api/demo/reset", { body: {} });
    await queryClient.invalidateQueries();
    toast({ title: "Demo data reset", sub: "Holds and checks cleared", icon: "check" });
  }
  async function unlink() {
    if (!p) return;
    await post("/api/family/unlink", { linkId: p.linkId });
    setUnlinking(false);
    await queryClient.invalidateQueries();
    router.push("/family/join");
  }
  async function signOut() {
    await post("/api/auth/sign-out", { app: "family" });
    queryClient.clear();
    router.push("/welcome");
  }

  return (
    <Screen
      tabs={<FamilyTabs active="settings" callName={callName} />}
      overlay={
        unlinking && p && (
          <Sheet onClose={() => setUnlinking(false)}>
            <h2 className="h2">Unlink from {p.name}?</h2>
            <p className="p">You will stop getting their alerts. They can invite you again with a new code.</p>
            <button className="btn red" onClick={unlink}>Yes, unlink</button>
            <button className="btn line" onClick={() => setUnlinking(false)}>Stay linked</button>
          </Sheet>
        )
      }
    >
      <h1 className="h1">Settings</h1>
      {p && (
        <div className="card row-card">
          <Avatar name={p.name} size={44} />
          <div className="grow"><b style={{ fontSize: 17 }}>{p.name}{callName !== p.name ? ` (${callName})` : ""}</b><p className="sm">Linked · {p.phone}</p></div>
          <button className="ghost" onClick={() => setUnlinking(true)}>Unlink</button>
        </div>
      )}
      <div className="card" style={{ gap: 14 }}>
        <div className="lbl">Alerts</div>
        <AlertToggles />
        <button className="btn line md-btn" onClick={test}>Send me a test alert</button>
      </div>
      <div className="card" style={{ border: "2px dashed var(--toggle-off)", background: "transparent", boxShadow: "none", gap: 10 }}>
        <div className="lbl">Demo tools</div>
        <button className="btn redline" onClick={reset}>Reset demo data</button>
        <p className="sm">Clears all holds and checks. Use between judges.</p>
      </div>
      <div className="spacer" />
      <button className="ghost" style={{ alignSelf: "center" }} onClick={signOut}>Sign out</button>
    </Screen>
  );
}
