"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import {
  Avatar, BackButton, clockTime, FamilyTabs, HighlightedText, LoadingScreen, Marks, Screen, Sheet, StatusPill, TitleRow, Toggle,
  useCall, useCountdown, useLeaveIfGone, useToast, VerdictPill,
} from "@/components/ui";
import { ADVICE_PRESETS, rupees, whatToSay } from "@/lib/check/copy";
import { playAlarm, unlockAudio } from "@/lib/client/alarm";
import { closeNotifications, pushPermission, pushStatusText, subscribeToPush, unsubscribeFromPush, type PushStatus } from "@/lib/client/push";
import { signOut } from "@/lib/client/sign-out";
import { api, operatorApi, post } from "@/lib/client/api";
import type { ActivityItem, CheckView, EventView, HoldView, ProtectedView, SharedMessage } from "@/lib/views";
import { LedgerCards, useCallOnArrival, useLedger } from "./phase2";
import { useFamily, useTabLabel } from "./shell";

const ADVICE_MAX = 200;

// ---------------- C1 / Q4 · accept invite ----------------

export function JoinScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { data: fam } = useFamily();
  // Already protecting someone (Arjun adds Mummy after Papa): this links one more person.
  const addingAnother = (fam?.people.length ?? 0) > 0;
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
      router.push(addingAnother || fam?.me.alertsReady ? "/family" : "/family/alerts-setup");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function notNow() {
    if (addingAnother) return router.push("/family/settings");
    await signOut("family");
    router.push("/welcome");
  }

  return (
    <Screen bodyStyle={{ alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        {who ? <Avatar name={who} size={88} /> : <span className="circle" style={{ width: 88, height: 88, background: "var(--chip)" }}><Icon name="people" size={40} /></span>}
      </div>
      <h1 className="h1 center-text">{who ? `${who} wants you as a trusted person` : addingAnother ? "Link another person" : "Enter your invite code"}</h1>
      <p className="p center-text">
        {who ? "If a message looks like a scam, or they are about to pay, you get an alert. Then you decide." : "Type the code you were sent. It starts with PB-."}
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
      <button className="ghost" style={{ alignSelf: "center" }} onClick={notNow}>{addingAnother ? "Back" : "Not now"}</button>
      <div className="spacer" />
      <p className="sm center-text">You see only what they check with Pause Button.</p>
    </Screen>
  );
}

// ---------------- C2 · enable alerts + test buzz ----------------

/** Tells the person what happened after they turned Notifications on. */
function usePushToast() {
  const toast = useToast();
  const texts: Record<PushStatus, { title: string; sub: string; tone?: "red" }> = {
    subscribed: { title: "Alerts will reach this phone", sub: "Even when the app is closed" },
    denied: { title: "Notifications are blocked", sub: "Allow them in your phone's settings for this site", tone: "red" },
    "needs-install": { title: "Install the app first", sub: "Share → Add to Home Screen, then turn this on" },
    unsupported: { title: "This browser cannot alert in the background", sub: "Use Chrome, or install the app" },
    off: { title: "Push is not set up on the server", sub: "Alerts still work while the app is open" },
    error: { title: "Could not turn on alerts on this phone", sub: "Try again, or use Chrome" },
  };
  return (status: PushStatus) => toast({ ...texts[status], icon: status === "subscribed" ? "bell" : "warn" });
}

const noSubscribe = () => () => {};
const pushStatusNow = () => pushStatusText();
const pushStatusServer = () => "";

function AlertToggles() {
  const { data } = useFamily();
  const queryClient = useQueryClient();
  const pushToast = usePushToast();
  // Reads Notification.permission on every render; "" while rendering on the server.
  const status = useSyncExternalStore(noSubscribe, pushStatusNow, pushStatusServer);
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
  async function onNotify(on: boolean) {
    if (on) {
      const result = await subscribeToPush("family"); // asks the phone's permission: must follow the tap
      pushToast(result);
    } else {
      await unsubscribeFromPush("family");
    }
    save.mutate({ alertNotify: on });
  }
  return (
    <>
      {rows.map(([title, sub, key]) => (
        <div className="row" key={key}>
          <div className="grow"><div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div><p className="sm">{key === "alertNotify" && status ? status : sub}</p></div>
          <Toggle on={data.me[key]} label={title} onChange={(v) => (key === "alertNotify" ? void onNotify(v) : save.mutate({ [key]: v }))} />
        </div>
      ))}
    </>
  );
}

const pushPermissionNow = () => pushPermission();
const pushPermissionServer = () => "" as const;
const inFrameNow = () => window.self !== window.top;
const notFramed = () => false;

/**
 * Until this phone allows notifications, alerts reach it only while the app is
 * open: the home screen says so and offers the one tap that fixes it. Hidden in
 * the demo panel's frames, where the phones are simulated.
 */
function PushHint() {
  const { data } = useFamily();
  const pushToast = usePushToast();
  const permission = useSyncExternalStore(noSubscribe, pushPermissionNow, pushPermissionServer);
  const framed = useSyncExternalStore(noSubscribe, inFrameNow, notFramed);
  const [, bump] = useState(0);
  if (!data || !data.me.alertNotify || framed) return null;
  if (permission !== "default" && permission !== "denied" && permission !== "needs-install") return null;
  async function turnOn() {
    pushToast(await subscribeToPush("family"));
    bump((n) => n + 1); // re-read the permission
  }
  const copy =
    permission === "denied"
      ? { title: "Notifications are blocked on this phone", sub: "Allow them for this site in your phone's settings, then come back here. Until then alerts reach you only while the app is open." }
      : permission === "needs-install"
        ? { title: "Install the app to get alerts when it is closed", sub: "Share → Add to Home Screen, then turn on Notifications in Settings." }
        : { title: "Alerts reach you only while the app is open", sub: "Turn on Notifications so a scam alert reaches you even when the app is closed or your phone is locked." };
  return (
    <div className="card tint-amber" style={{ gap: 8 }} data-testid="push-hint">
      <div className="row"><Icon name="bell" /><b className="grow" style={{ fontSize: 16 }}>{copy.title}</b></div>
      <p className="sm" style={{ color: "var(--text)" }}>{copy.sub}</p>
      {permission === "default" && <button className="btn amber" style={{ minHeight: 48 }} onClick={turnOn}>Turn on notifications</button>}
    </div>
  );
}

function useTestAlert() {
  const { data } = useFamily();
  const toast = useToast();
  return () => {
    unlockAudio();
    playAlarm("urgent", { sound: data?.me.alertSound ?? true, vibrate: data?.me.alertVibrate ?? true });
    // Also a real push to this phone's notification bar, when it is registered for them.
    void post<{ sent: number }>("/api/push/test")
      .then((r) => toast({ title: "Test alert sent", sub: r.sent ? "Check your notification bar too" : "This is how a scam alert feels", icon: "bell" }))
      .catch(() => toast({ title: "Test alert sent", sub: "This is how a scam alert feels", icon: "bell" }));
  };
}

export function AlertsSetupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const test = useTestAlert();
  const pushToast = usePushToast();
  const { data } = useFamily();
  async function done() {
    // "Done" is the tap that lets us ask for notification permission.
    if (data?.me.alertNotify ?? true) {
      const result = await subscribeToPush("family");
      if (result !== "subscribed") pushToast(result);
    }
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
  const label = useTabLabel();
  const { data } = useFamily();
  const ledger = useLedger();
  if (!data) return <LoadingScreen />;
  // One person: the design's J1 home. Several (Papa and Mummy): one card each.
  if (data.people.length === 1) return <PersonHome person={data.people[0]} />;
  return (
    <Screen tabs={<FamilyTabs active="home" callName={label} />}>
      <h1 className="h1">Who you protect</h1>
      <p className="sm">You get an alert when any of them gets a scam message or is about to pay.</p>
      <PushHint />
      {data.people.map((p) => (
        <PersonCard key={p.id} p={p} me={data.me.name} serverNow={data.serverNow} onOpen={() => router.push(`/family/person/${p.id}`)} />
      ))}
      {ledger.data && <LedgerCards ledger={ledger.data} me={data.me.name} />}
      <button className="btn line" onClick={() => router.push("/family/join")}><Icon name="plus" />Link another person</button>
      <div className="spacer" />
      <p className="sm center-text">Keep this app open or installed on your home screen.</p>
    </Screen>
  );
}

/** J0 · one protected person on the "Who you protect" list, with what needs doing. */
function PersonCard({ p, me, serverNow, onOpen }: { p: ProtectedView; me: string; serverNow: string; onOpen: () => void }) {
  const hold = p.activeHold;
  const clock = useCountdown(hold?.expiresAt, serverNow);
  const needsMe = !!hold && !hold.approvedBy.includes(me) && !clock.expired;
  const status = hold
    ? clock.expired
      ? `${rupees(hold.amount)} still on hold · time is up`
      : needsMe
        ? `${rupees(hold.amount)} payment paused · ${clock.label} left`
        : `You approved · waiting for ${hold.waitingFor.join(" and ")}`
    : p.openAlerts
      ? `${p.openAlerts} message${p.openAlerts > 1 ? "s" : ""} to look at`
      : `${p.callName} is protected`;
  const tone = needsMe ? "solid-red" : hold || p.openAlerts ? "tint-amber" : "tint-green";
  return (
    <button className={`card ${tone}`} onClick={onOpen} data-testid={`person-${p.id}`}>
      <div className="row">
        <Avatar name={p.name} />
        <div className="grow">
          <div className="h2" style={{ fontSize: 20 }}>{p.callName}{p.callName !== p.name ? ` · ${p.name}` : ""}</div>
          <p className="sm" style={{ color: "inherit", opacity: 0.85 }}>
            Phone {p.online ? "online" : "offline"} · {p.today.total ? `${p.today.total} checked today` : "no checks today"}
          </p>
        </div>
        <Icon name="chev" />
      </div>
      <b style={{ fontSize: 17 }}>{status}</b>
    </button>
  );
}

/** J1 · one person's home: `/family/person/[id]`, or the whole home when only one person is linked. */
export function PersonScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data } = useFamily();
  const person = data?.people.find((p) => p.id === id);
  useEffect(() => {
    if (data && !person) router.replace("/family");
  }, [data, person, router]);
  if (!data || !person) return <LoadingScreen />;
  return <PersonHome person={person} back={data.people.length > 1} />;
}

function PersonHome({ person: p, back }: { person: ProtectedView; back?: boolean }) {
  const router = useRouter();
  const label = useTabLabel();
  const { data } = useFamily();
  const ledger = useLedger();
  const callName = p.callName;
  const hold = p.activeHold;
  const clock = useCountdown(hold?.expiresAt, data?.serverNow, (hold?.holdMinutes ?? 10) * 60_000);
  if (!data) return <LoadingScreen />;
  const me = data.me.name;
  // Questions, heads-ups, and scam alerts with no payment to block (e.g. a fake KYC link).
  // A live scam call has its own card below.
  const openItems = data.alerts.filter((a) => a.owner.id === p.id && (a.kind !== "urgent" || (!a.holdId && a.source !== "call")));
  const liveCall = data.alerts.find((a) => a.owner.id === p.id && a.kind === "urgent" && a.source === "call");

  return (
    <Screen tabs={<FamilyTabs active="home" callName={label} />}>
      <div className="row">
        {back && <BackButton href="/family" />}
        <Avatar name={p.name} />
        <div className="grow">
          <div className="h2" style={{ fontSize: 22 }}>{p.name}{callName !== p.name ? ` (${callName})` : ""}</div>
          <p className="sm">Linked · phone {p.online ? "online" : "offline"}</p>
        </div>
        <span className="tag g">LINKED</span>
      </div>
      <PushHint />

      {hold && !clock.expired && hold.approvedBy.includes(me) && (
        <div className="card tint-amber" style={{ gap: 10, padding: 18 }}>
          <span className="lbl" style={{ color: "var(--text)" }}>You approved</span>
          <h2 className="h2">{rupees(hold.amount)} still paused</h2>
          <p className="p" style={{ fontSize: 16 }}>Waiting for {hold.waitingFor.join(" and ")} to approve too. {clock.label} left.</p>
          <button className="btn ink" style={{ minHeight: 56 }} onClick={() => router.push(`/family/hold/${hold.id}`)}>Open</button>
        </div>
      )}
      {hold && !clock.expired && !hold.approvedBy.includes(me) && (
        <div className="card solid-red" style={{ gap: 10, padding: 18 }}>
          <span className="lbl" style={{ color: "#fff" }}>Action needed</span>
          <h2 className="h2" style={{ color: "#fff", fontSize: 28 }}>{rupees(hold.amount)} payment paused</h2>
          <p className="p" style={{ fontSize: 16 }}>
            {clock.label} left to decide. {callName} is waiting.
            {hold.approvedBy.length ? ` ${hold.approvedBy.join(" and ")} approved; it needs you too.` : ""}
          </p>
          <button className="btn white" style={{ minHeight: 56 }} onClick={() => router.push(`/family/hold/${hold.id}`)}>Open</button>
        </div>
      )}
      {hold && clock.expired && (
        <div className="card tint-amber" style={{ gap: 10 }}>
          <span className="lbl" style={{ color: "var(--text)" }}>Time is up</span>
          <h2 className="h2">{rupees(hold.amount)} still on hold</h2>
          <p className="p" style={{ fontSize: 16 }}>Nobody decided in {hold.holdMinutes} minutes. Block still works.</p>
          <button className="btn ink" style={{ minHeight: 56 }} onClick={() => router.push(`/family/hold/${hold.id}`)}>Open</button>
        </div>
      )}
      {liveCall && (
        <button className="card solid-red" style={{ gap: 6 }} onClick={() => router.push(`/family/check/${liveCall.checkId}?alert=${liveCall.id}`)}>
          <span className="lbl" style={{ color: "#fff" }}>Right now</span>
          <h2 className="h2" style={{ color: "#fff", fontSize: 24 }}>{callName} is on a scam call</h2>
          <p className="sm" style={{ color: "#fff" }}>A caller is pressuring {callName}. Call and tell them to hang up.</p>
        </button>
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
          <p className="p">No payments are paused. {p.today.total ? `${p.today.total} checked today.` : "No checks yet today."}</p>
        </div>
      )}
      {p.lastCheck && (
        <button className="card" onClick={() => router.push(`/family/check/${p.lastCheck!.id}`)}>
          <div className="lbl">Last check</div>
          <div className="row"><VerdictPill verdict={p.lastCheck.verdict} size="small" icon={false} /><span className="sm grow">{clockTime(p.lastCheck.createdAt)} · {p.lastCheck.title}</span></div>
          <Marks phrases={p.lastCheck.phrases} size={16} />
        </button>
      )}
      {ledger.data && <LedgerCards ledger={ledger.data} me={me} />}
      {p.today.total > 0 ? (
        <div className="card">
          <div className="lbl">Today</div>
          <div className="row">
            <b className="grow" style={{ fontSize: 20 }}>{p.today.total} message{p.today.total === 1 ? "" : "s"} checked</b>
            <span className="sm">{p.today.scam} scam · {p.today.suspicious} suspicious · {p.today.safe} safe</span>
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
  const { data } = useFamily();
  const alert = data?.alerts.find((a) => a.id === id);
  useEffect(() => {
    if (data && !alert) router.replace("/family");
  }, [data, alert, router]);
  if (!alert) return <LoadingScreen />;
  const callName = alert.owner.callName;

  async function open() {
    await post(`/api/family/alerts/${id}/opened`).catch(() => {});
    void closeNotifications((tag) => tag === `alert-${id}`);
    router.push(alert!.holdId ? `/family/hold/${alert!.holdId}` : `/family/check/${alert!.checkId}?alert=${id}`);
  }
  const others = alert.otherRecipients;

  if (alert.kind === "urgent") {
    const onCall = alert.source === "call";
    return (
      <Screen tone="red" center bodyStyle={{ color: "#fff", gap: 18, justifyContent: "flex-start" }}>
        <span className="lbl" style={{ color: "#fff", fontSize: 15, marginTop: 20 }}>{callName} needs you now</span>
        <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center", margin: "6px 0" }}>
          <span className="pulse-ring" style={{ inset: 0, border: "3px solid rgba(255,255,255,.35)" }} />
          <span className="pulse-ring" style={{ inset: 26, border: "3px solid rgba(255,255,255,.6)", animationDelay: ".6s" }} />
          <span className="circle" style={{ width: 96, height: 96, background: "#fff", color: "#B3291E" }}><Icon name={onCall ? "phone" : "bell"} size={44} /></span>
        </div>
        <h1 className="h1" style={{ color: "#fff", fontSize: 40 }}>{onCall ? `${callName} is on a scam call` : `${callName} got a scam message`}</h1>
        <p className="p" style={{ fontSize: 20 }}>
          {onCall
            ? `A caller is pressuring ${callName} right now. Call and tell them to hang up.`
            : `${alert.amount ? `It asks for ${rupees(alert.amount)}. Nothing is paid. ` : "Nothing is paid. "}Tell them what to do.`}
        </p>
        <span className="pill medium" style={{ background: "#fff", color: "#14202B", alignSelf: "center" }}>
          {others.length ? `Sent to ${listNames(["you", ...others])}` : "Sent to you"}
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
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const call = useCall();
  const toast = useToast();
  const { data: fam } = useFamily();
  const q = useQuery({
    queryKey: ["family-hold", id],
    queryFn: () => api<{ hold: HoldView; message: SharedMessage | null; timeline: EventView[]; serverNow: string }>(`/api/family/holds/${id}`),
    refetchInterval: 2000,
  });
  useLeaveIfGone(q.error, "/family");
  const [advice, setAdvice] = useState(ADVICE_PRESETS[0]);
  // F2 "It's fine" on the lock screen lands on the approve step; approving still needs this second confirm.
  const [confirm, setConfirm] = useState(search.get("approve") === "1");
  const [error, setError] = useState<string | null>(null);
  const hold = q.data?.hold;
  const callName = hold?.owner.callName ?? "Papa";
  const papaPhone = hold?.owner.phone ?? null;
  const clock = useCountdown(hold?.expiresAt, q.data?.serverNow, (hold?.holdMinutes ?? 10) * 60_000);
  // F2 "Call Papa" on the lock screen's "You blocked it" notification.
  useCallOnArrival(search.get("call") === "1", callName, papaPhone);
  // Advice is oldest first (Mr Rao sees the first reply), so the one just sent is last.
  const lastAdvice = hold?.advice[hold.advice.length - 1];

  // Opening the hold counts as opening its alert ("status seen").
  const opened = useRef(false);
  useEffect(() => {
    const a = fam?.alerts.find((x) => x.holdId === id && !x.openedAt);
    if (a && !opened.current) {
      opened.current = true;
      void post(`/api/family/alerts/${a.id}/opened`);
      void closeNotifications((tag) => tag === `alert-${a.id}`);
    }
  }, [fam, id]);

  const decide = useMutation({
    mutationFn: async (decision: "block" | "approve") => {
      // F11: words he wrote go with the block, so Papa reads them on the green screen.
      if (decision === "block" && advice.trim() && advice.trim() !== q.data?.hold.advice[0]?.text) {
        await post(`/api/family/holds/${id}/advice`, { text: advice.trim().slice(0, ADVICE_MAX) }).catch(() => {});
      }
      return post(`/api/family/holds/${id}/decision`, { decision, confirm: decision === "approve" });
    },
    onSuccess: async (view, decision) => {
      setConfirm(false);
      await queryClient.invalidateQueries();
      const v = view as HoldView;
      toast(
        decision === "block"
          ? { title: "Payment blocked", sub: `${callName}'s screen shows it now`, icon: "check" }
          : v.status === "approved"
            ? { title: "Everyone approved", sub: "The demo payment is released", icon: "personCheck" }
            : { title: "Your approval is saved", sub: `Waiting for ${v.waitingFor.join(" and ")}`, icon: "personCheck" },
      );
    },
    onError: async (e) => {
      setConfirm(false);
      setError(e.message);
      await queryClient.invalidateQueries();
    },
  });

  async function sendAdvice() {
    // Start sending, then open the dialer straight from the tap (phones only
    // allow the dialer from a user gesture); the request carries on meanwhile.
    const sent = post(`/api/family/holds/${id}/advice`, { text: advice.trim().slice(0, ADVICE_MAX) });
    call(callName, papaPhone);
    await sent;
    await queryClient.invalidateQueries({ queryKey: ["family-hold", id] });
    toast({ title: `Advice sent to ${callName}`, sub: "They can see it now", icon: "bell" });
  }

  if (!hold) return <LoadingScreen />;
  const status = hold.status === "pending" && clock.expired ? "expired" : hold.status;
  const amount = rupees(hold.amount);
  const msg = q.data?.message;
  const iApproved = !!fam && hold.approvedBy.includes(fam.me.name);
  const others = hold.waitingFor.filter((n) => n !== fam?.me.name);
  const unsent = advice.trim().length > 0 && advice.trim() !== hold.advice[0]?.text;
  const reportable = msg?.link && msg.link.status !== "known";
  const linkRow = reportable && (
    <button className="card row-card" style={{ padding: "10px 14px" }} onClick={() => router.push(`/family/link/${hold.checkId}`)} data-testid="link-row">
      <Icon name="link" />
      <div className="grow">
        <div className="lbl">The link in {callName}&apos;s message</div>
        <b style={{ fontSize: 16, wordBreak: "break-all" }}>{msg!.link!.domain}</b>
      </div>
      <span className="tag">REPORT</span>
    </button>
  );

  if (status === "blocked" || status === "approved" || status === "cancelled") {
    const me = fam?.me.name;
    const byMe = hold.decidedByName === me;
    const title =
      status === "cancelled"
        ? `${callName} cancelled it`
        : status === "approved"
          ? hold.approvedBy.length > 1
            ? "Everyone approved it"
            : byMe
              ? "You approved it"
              : `${hold.decidedByName} approved it`
          : byMe
            ? "You blocked it"
            : `${hold.decidedByName} blocked it`;
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
        {msg && <VictimMessage msg={msg} callName={callName} />}
        {linkRow}
        {status !== "approved" && (
          <div className="card tint-amber">
            <b style={{ fontSize: 17 }}>Next</b>
            <p className="sm" style={{ color: "var(--text)" }}>
              Call {callName} and stay with them while they check their bank app. Tell them not to answer that caller again.
            </p>
          </div>
        )}
        <div className="spacer" />
        <button className="btn green" onClick={() => call(callName, papaPhone)}><Icon name="phone" />Call {callName}</button>
        <button className="btn line" onClick={() => router.push("/family")}>Back to home</button>
      </Screen>
    );
  }

  const told = msg ? (
    <VictimMessage msg={msg} callName={callName} note={hold.verdict === "SCAM" ? "Scammers often ask for secrecy and money together. That is always a scam." : undefined} />
  ) : (
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
            Nobody decided in {hold.holdMinutes} minutes, so {callName}&apos;s money is still on hold. {callName} has been told to call you or the helpline.
          </p>
        </div>
        {told}
        {linkRow}
        {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
        <div className="spacer" />
        <button className="btn green" style={{ minHeight: 64 }} onClick={() => call(callName, papaPhone)}><Icon name="phone" />Call {callName}</button>
        <button className="btn red" style={{ minHeight: 64 }} onClick={() => decide.mutate("block")}>Block this payment</button>
      </Screen>
    );
  }

  return (
    <Screen overlay={confirm && <ApproveSheet hold={hold} callName={callName} onKeep={() => setConfirm(false)} onApprove={() => decide.mutate("approve")} others={others} />}>
      <TitleRow title={`${callName}'s payment`} back="/family" right={<span className="pill medium ink">{clock.label}</span>} />
      <div className="row"><VerdictPill verdict={hold.verdict} size="medium" icon={false} /><span style={{ fontWeight: 800, fontSize: 18 }}>{amount} paused</span></div>
      {hold.twoKeys && (
        <div className="card" style={{ border: "2px solid var(--text)", gap: 6 }} data-testid="two-keys">
          <div className="row"><Icon name="people" /><b style={{ fontSize: 17 }}>This one needs two of you</b></div>
          <p className="sm">Above Rs 50,000 we hold for an hour and ask two trusted people, the way a bank asks two signatures. One tired person should not carry this alone.</p>
        </div>
      )}
      {told}
      {linkRow}
      {/* F11 · advice in his own words: the chips are a start, the sentence is his. */}
      <div className="card" style={{ border: "2px solid var(--text)", gap: 10 }}>
        <div className="lbl" style={{ color: "var(--text)" }}>Tell {callName} what to do</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {ADVICE_PRESETS.map((a) => (
            <button key={a} className={`chip ${advice === a ? "on" : ""}`} style={{ fontSize: 14, padding: "7px 12px" }} onClick={() => setAdvice(a)}>
              {a.split(".")[0]}
            </button>
          ))}
        </div>
        <label>
          <div className="lbl">Your message</div>
          <textarea
            className="ta small"
            aria-label="Your message"
            value={advice}
            maxLength={ADVICE_MAX}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder={`${callName}, this is the same trick that got Sharma uncle. Do not pick up if they ring again. I am leaving office now.`}
          />
        </label>
        <div className="row">
          <span className="sm grow">In your words</span>
          <span className="sm">{advice.length} / {ADVICE_MAX}</span>
        </div>
        {lastAdvice && <p className="sm">Sent: “{lastAdvice.text}” ({lastAdvice.fromName}, {clockTime(lastAdvice.createdAt)})</p>}
      </div>
      {(hold.twoKeys || hold.approvedBy.length > 0 || hold.waitingFor.length > 1) && (
        <div className="card" style={{ gap: 8 }}>
          <div className="lbl" style={{ color: "var(--text)" }}>{hold.twoKeys ? "Who has decided" : "Who decides"}</div>
          {hold.approvedBy.map((n) => (
            <div className="row" key={n}><span className="dot" style={{ background: "#2E7D5B" }} /><b className="grow">{n === fam?.me.name ? "You" : n} approved</b></div>
          ))}
          {hold.waitingFor.map((n) => (
            <div className="row" key={n}><span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)" }} /><b className="grow">{n === fam?.me.name ? "You" : n}: {hold.twoKeys ? "alerted · waiting" : "not yet"}</b></div>
          ))}
          <p className="sm">{hold.twoKeys ? "One block is enough to stop it. The second person is only needed to release it." : "One Block from anyone stops it. The money moves only when everyone approves."}</p>
        </div>
      )}
      <p className="sm">He will read this on his screen. A sentence from you lands harder than a sentence from an app.</p>
      {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
      <div className="spacer" />
      <button className="btn green" style={{ minHeight: 64 }} onClick={sendAdvice}><Icon name="phone" />Send and call {callName}</button>
      <button className="btn red" style={{ minHeight: 64 }} disabled={decide.isPending} onClick={() => decide.mutate("block")} data-testid="block">
        {unsent ? "Send and block this payment" : "Block this payment"}
      </button>
      {iApproved ? (
        <p className="sm center-text">You approved. {hold.twoKeys ? `Release needs ${hold.waitingFor.join(" and ")} too.` : `Waiting for ${hold.waitingFor.join(" and ")}.`}</p>
      ) : (
        <button className="btn line sm-btn" onClick={() => setConfirm(true)}>{hold.twoKeys && others.length ? `Approve (release needs ${others.join(" and ")} too)` : "Approve (I know this payment)"}</button>
      )}
    </Screen>
  );
}

function ApproveSheet({ hold, callName, onKeep, onApprove, others }: { hold: HoldView; callName: string; onKeep: () => void; onApprove: () => void; others: string[] }) {
  return (
    <Sheet onClose={onKeep}>
      <h2 className="h2">Approve this payment?</h2>
      <p className="p">
        {callName} was warned about {hold.phrases.slice(0, 2).map((p) => `“${p}”`).join(" and ")}. Only approve if you know who they are paying.
        {others.length ? ` ${others.join(" and ")} must approve too before the money moves.` : ""}
      </p>
      <button className="btn red" style={{ minHeight: 64 }} onClick={onKeep}>No, keep it blocked</button>
      <button className="btn line md-btn" onClick={onApprove}>Yes, approve</button>
    </Sheet>
  );
}

/** "you, Meera and Dinesh" */
const listNames = (names: string[]) => (names.length <= 1 ? names[0] ?? "" : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);

/** The exact message Papa received, shown once the family member opens the alert. */
function VictimMessage({ msg, callName, note }: { msg: SharedMessage; callName: string; note?: string }) {
  const from =
    msg.source === "paste"
      ? `${callName} pasted it into Pause Button`
      : msg.source === "share"
        ? `${callName} forwarded it from ${msg.senderLabel ?? "another app"}`
        : msg.source === "voice"
          ? `${callName} said it aloud to Pause Button`
          : msg.source === "call"
            ? `${callName} answered the call guard's questions`
            : `${msg.source === "sms" ? "SMS" : "WhatsApp"} from ${msg.senderLabel ?? "an unknown number"}`;
  return (
    <div className="card" data-testid="victim-message">
      <div className="row">
        <Icon name={msg.source === "call" ? "phone" : "msg"} />
        <div className="grow">
          <div className="lbl" style={{ color: "var(--text)" }}>{msg.source === "call" ? `What ${callName} told us` : `The message ${callName} got`}</div>
          <p className="sm">{from}</p>
        </div>
      </div>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, padding: "10px 12px" }}>
        <HighlightedText text={msg.text} signals={msg.signals} link={msg.link} />
      </div>
      <p className="sm">Highlighted: the warning signs we found.{note ? ` ${note}` : ""}</p>
    </div>
  );
}

// ---------------- O2 · heads-up detail / "Ask Arjun" answer ----------------

export function FamilyCheckScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const call = useCall();
  const toast = useToast();
  const { data: fam } = useFamily();
  const q = useQuery({ queryKey: ["family-check", id], queryFn: () => api<CheckView>(`/api/family/checks/${id}`), refetchInterval: 3000 });
  useLeaveIfGone(q.error, "/family");
  const callName = q.data?.owner.callName ?? "Papa";
  const papaPhone = q.data?.owner.phone ?? null;
  const alertId = search.get("alert");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!alertId) return;
    void post(`/api/family/alerts/${alertId}/opened`).catch(() => {});
    void closeNotifications((tag) => tag === `alert-${alertId}`);
  }, [alertId]);

  const answer = useMutation({
    mutationFn: (v: { verdict: "scam" | "not_scam"; note?: string }) =>
      post<{ final: "scam" | "not_scam" | null; waitingFor: string[] }>(`/api/family/checks/${id}/verdict`, v),
    onSuccess: async (r, v) => {
      setConfirmClear(false);
      await queryClient.invalidateQueries();
      toast(
        v.verdict === "scam"
          ? { title: "Marked as a scam", sub: `${callName}'s screen says: scam, do not pay`, icon: "check" }
          : r.final === "not_scam"
            ? { title: "Everyone said not a scam", sub: `${callName}'s screen now says: not a scam`, icon: "check" }
            : { title: "Your answer is saved", sub: `It counts once ${r.waitingFor.join(" and ")} agrees too`, icon: "check" },
      );
      router.push("/family");
    },
    onError: (e) => {
      setConfirmClear(false);
      toast({ title: "Not saved", sub: e.message, icon: "warn", tone: "red" });
    },
  });
  const [note, setNote] = useState("");
  const sayScam = () => answer.mutate({ verdict: "scam", note: note.trim().slice(0, ADVICE_MAX) || "It is a scam. Do not pay or reply." });
  const sayNotScam = () => answer.mutate({ verdict: "not_scam", note: note.trim().slice(0, ADVICE_MAX) || "I checked. This one is fine." });

  const c = q.data;
  if (!c) return <LoadingScreen />;
  const fromAsk = fam?.alerts.some((a) => a.checkId === id && a.kind === "ask") || (!!c.askedFamilyAt && !c.familyVerdict);
  // Urgent alerts come only from scams he brought in himself and pay attempts, so the title
  // stays "Scam alert" when the screen is reopened after the alert is handled.
  const urgent =
    !fromAsk && (!!fam?.alerts.some((a) => a.checkId === id && a.kind === "urgent") || !!c.hold || (c.verdict === "SCAM" && c.source !== "sms" && c.source !== "whatsapp"));
  const pending = c.hold && c.hold.status === "pending";
  const onCall = c.source === "call";
  const sourceLine =
    c.source === "paste" ? `Checked by ${callName}`
    : c.source === "share" ? `Forwarded by ${callName} from ${c.senderLabel ?? "another app"}`
    : c.source === "voice" ? `${callName} said it aloud`
    : onCall ? `${callName} is on a call right now`
    : `Detected on ${callName}'s phone · ${c.source === "sms" ? "SMS" : "WhatsApp"} · ${c.senderLabel}`;
  // The design's quiet heads-up (O2) says "Mark as handled"; urgent alerts and questions say "It's a scam".
  const myKinds = fam?.alerts.filter((a) => a.checkId === id).map((a) => a.kind) ?? [];
  const headsUpOnly = myKinds.length > 0 && myKinds.every((k) => k === "headsup");

  return (
    <Screen
      overlay={
        confirmClear && (
          <Sheet onClose={() => setConfirmClear(false)}>
            <h2 className="h2">Tell {callName} it is not a scam?</h2>
            <p className="p">
              Pause Button called this a SCAM
              {c.signals.length || c.link ? ` because of ${[...c.signals.slice(0, 2).map((s) => `“${s.phrase}”`), ...(c.link && c.link.status !== "known" ? [c.link.domain] : [])].join(", ")}` : ""}.
              {" "}Only say it is fine if you know who sent it. {callName}&apos;s screen will then say “not a scam”.
            </p>
            <button className="btn red" style={{ minHeight: 64 }} onClick={sayScam}>No, it is a scam</button>
            <button className="btn line md-btn" onClick={sayNotScam}>Yes, it is not a scam</button>
          </Sheet>
        )
      }
    >
      <TitleRow title={onCall ? `${callName} is on a scam call` : fromAsk ? `${callName} is asking` : urgent ? "Scam alert" : "Heads-up"} back="/family" right={<VerdictPill verdict={c.finalVerdict} size="medium" icon={false} />} />
      <p className="sm">{sourceLine} · {clockTime(c.createdAt)}</p>
      {onCall && c.callAnswers && (
        <div className="card solid-red" style={{ gap: 8 }}>
          <b style={{ fontSize: 18 }}>Call {callName} now and tell them to hang up.</b>
          {(["video", "money", "secrecy"] as const).map((k) => (
            <div className="row" key={k} style={{ color: "#fff" }}>
              <Icon name={c.callAnswers![k] ? "x" : "check"} size={20} />
              <span style={{ fontSize: 15, fontWeight: 700 }}>
                {k === "video" ? "Video call" : k === "money" ? "Asked for money or a code" : "Asked for secrecy"}: {c.callAnswers![k] ? "yes" : "no"}
              </span>
            </div>
          ))}
        </div>
      )}
      {c.messageText ?? c.simText ? (
        <VictimMessage
          msg={{ text: (c.messageText ?? c.simText)!, signals: c.signals, link: c.link, source: c.source, senderLabel: c.senderLabel }}
          callName={callName}
          note={c.familyTitle ? `Looks like ${c.familyTitle[0].toLowerCase() + c.familyTitle.slice(1)}.` : undefined}
        />
      ) : (
        <div className="card">
          <div className="lbl">What {callName} was told</div>
          <Marks phrases={[...c.signals.map((s) => s.phrase), ...(c.link && c.link.status !== "known" ? [c.link.domain] : [])].slice(0, 4)} />
          {c.familyTitle && <p className="sm">Looks like {c.familyTitle[0].toLowerCase() + c.familyTitle.slice(1)}.</p>}
        </div>
      )}
      {c.reportable && (
        <button className="card row-card" style={{ padding: "10px 14px" }} onClick={() => router.push(`/family/link/${c.id}`)} data-testid="link-row">
          <Icon name="link" />
          <div className="grow">
            <div className="lbl">The link in {callName}&apos;s message</div>
            <b style={{ fontSize: 16, wordBreak: "break-all" }}>{c.reportable.domain}</b>
          </div>
          <span className="tag">{c.reportable.reported === "blocked" ? "BLOCKED" : c.reportable.reported === "none" ? "REPORT" : "REPORTED"}</span>
        </button>
      )}
      {pending ? (
        <button className="card solid-red" onClick={() => router.push(`/family/hold/${c.hold!.id}`)}>
          <b style={{ fontSize: 17 }}>{rupees(c.hold!.amount)} payment paused</b>
          <p className="sm" style={{ color: "#fff" }}>Open it to block or approve.</p>
        </button>
      ) : onCall ? null : (
        <div className="card">
          <b style={{ fontSize: 17 }}>No payment has been paused</b>
          <p className="sm">If {callName} tries to pay, you get an urgent alert and they cannot continue until you decide.</p>
        </div>
      )}
      {c.familyVerdict ? (
        <div className={`card ${c.familyVerdict === "not_scam" ? "tint-green" : "tint-red"}`}>
          <b style={{ fontSize: 17 }}>{c.familyVerdictByName} said: {c.familyVerdict === "not_scam" ? "not a scam" : "a scam"}</b>
        </div>
      ) : c.answers.length ? (
        <div className="card" style={{ gap: 8 }}>
          <div className="lbl" style={{ color: "var(--text)" }}>Answers so far</div>
          {c.answers.map((a) => (
            <div className="row" key={a.memberId}>
              <span className="dot" style={{ background: a.verdict === "scam" ? "#C6372B" : "#2E7D5B" }} />
              <b className="grow">{a.memberId === fam?.me.id ? "You" : a.name}: {a.verdict === "scam" ? "a scam" : "not a scam"}</b>
            </div>
          ))}
          {c.waitingFor.map((n) => (
            <div className="row" key={n}>
              <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)" }} />
              <b className="grow">{n === fam?.me.name ? "You" : n}: not yet</b>
            </div>
          ))}
          <p className="sm">One “scam” settles it. “Not a scam” counts only when everyone says so.</p>
        </div>
      ) : (
        <div className="card">
          <div className="lbl">What to say</div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{whatToSay(c.verdict, callName)}</p>
        </div>
      )}
      {c.canAnswer && !pending && (
        <label className="card" style={{ gap: 6 }}>
          <div className="lbl">In your words (optional)</div>
          <textarea className="ta small" aria-label="In your words" value={note} maxLength={ADVICE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={`${callName}, do not pick up if they ring again.`} />
          <span className="sm" style={{ alignSelf: "flex-end" }}>{note.length} / {ADVICE_MAX}</span>
        </label>
      )}
      <div className="spacer" />
      <button className="btn green" onClick={() => call(callName, papaPhone)}><Icon name="phone" />Call {callName}</button>
      {c.canAnswer && !pending && (
        <>
          <button className="btn red" onClick={sayScam}>{headsUpOnly ? "Mark as handled" : "It's a scam"}</button>
          <button className="btn line" onClick={() => (c.verdict === "SCAM" ? setConfirmClear(true) : sayNotScam())}>This is not a scam</button>
        </>
      )}
    </Screen>
  );
}

// ---------------- J3 · activity ----------------

export function ActivityScreen() {
  const router = useRouter();
  const label = useTabLabel();
  const { data: fam } = useFamily();
  const several = (fam?.people.length ?? 0) > 1;
  const [filter, setFilter] = useState<"all" | "scams" | "safe">("all");
  const q = useQuery({ queryKey: ["family-activity"], queryFn: () => api<ActivityItem[]>("/api/family/activity"), refetchInterval: 4000 });
  const items = (q.data ?? []).filter((i) =>
    filter === "all" ? true : filter === "safe" ? i.label === "SAFE" : i.label !== "SAFE",
  );
  return (
    <Screen tabs={<FamilyTabs active="activity" callName={label} />}>
      <div className="row">
        <h1 className="h1 grow">Activity</h1>
        <button className="ghost" onClick={() => router.push("/family/month")}>Your month</button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {(["all", "scams", "safe"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
        ))}
      </div>
      {q.isPending && <div className="card"><span className="sk" /></div>}
      {!q.isPending && !items.length && <p className="p" style={{ color: "var(--muted)" }}>Nothing here yet.</p>}
      {items.map((i) => (
        <button key={i.id + i.kind} className="card" onClick={() => router.push(i.kind === "hold" ? `/family/hold/${i.id}` : `/family/check/${i.checkId}`)}>
          <div className="row">
            <StatusPill label={i.label} />
            {several && <span className="tag">{i.owner.callName.toUpperCase()}</span>}
            <span className="grow" />
            <span className="sm">{clockTime(i.createdAt)}</span>
          </div>
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
  const label = useTabLabel();
  const toast = useToast();
  const test = useTestAlert();
  const { data } = useFamily();
  const [unlinking, setUnlinking] = useState<ProtectedView | null>(null);

  async function reset() {
    await operatorApi("/api/demo/reset", { body: {} });
    await queryClient.invalidateQueries();
    toast({ title: "Demo data reset", sub: "Holds and checks cleared", icon: "check" });
  }
  async function unlink() {
    if (!unlinking) return;
    await post("/api/family/unlink", { linkId: unlinking.linkId });
    setUnlinking(null);
    await queryClient.invalidateQueries();
    if ((data?.people.length ?? 0) <= 1) router.push("/family/join");
  }
  async function leave() {
    await signOut("family");
    queryClient.clear();
    router.push("/welcome");
  }

  return (
    <Screen
      tabs={<FamilyTabs active="settings" callName={label} />}
      overlay={
        unlinking && (
          <Sheet onClose={() => setUnlinking(null)}>
            <h2 className="h2">Unlink from {unlinking.name}?</h2>
            <p className="p">You will stop getting their alerts. They can invite you again with a new code.</p>
            <button className="btn red" onClick={unlink}>Yes, unlink</button>
            <button className="btn line" onClick={() => setUnlinking(null)}>Stay linked</button>
          </Sheet>
        )
      }
    >
      <h1 className="h1">Settings</h1>
      <div className="lbl">People you protect</div>
      {data?.people.map((p) => (
        <div className="card row-card" key={p.id}>
          <Avatar name={p.name} size={44} />
          <div className="grow"><b style={{ fontSize: 17 }}>{p.name}{p.callName !== p.name ? ` (${p.callName})` : ""}</b><p className="sm">Linked · {p.phone}</p></div>
          <button className="ghost" onClick={() => setUnlinking(p)}>Unlink</button>
        </div>
      ))}
      <button className="btn line md-btn" onClick={() => router.push("/family/join")}><Icon name="plus" />Link another person</button>
      <div className="card" style={{ gap: 14 }}>
        <div className="lbl">Alerts</div>
        <AlertToggles />
        <button className="btn line md-btn" onClick={test}>Send me a test alert</button>
      </div>
      <div className="card" style={{ border: "2px dashed var(--toggle-off)", background: "transparent", boxShadow: "none", gap: 10 }}>
        <div className="lbl">Demo tools</div>
        <button className="btn redline" onClick={reset}>Reset demo data</button>
        <p className="sm">Clears all holds and checks. Use between judges.</p>
        <button className="btn line md-btn" onClick={() => router.push("/family/lock")}><Icon name="lock" />Show the lock screen</button>
        <p className="sm">What an urgent alert looks like with the phone locked: Block works without unlocking.</p>
      </div>
      <div className="spacer" />
      <button className="ghost" style={{ alignSelf: "center" }} onClick={leave}>Sign out</button>
    </Screen>
  );
}
