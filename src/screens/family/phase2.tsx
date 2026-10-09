"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, FamilyTabs, holdTotalMs, LoadingScreen, Screen, TitleRow, useCall, useCountdown, useLeaveIfGone, useNow, useToast } from "@/components/ui";
import { rupees, rupeesShort } from "@/lib/check/copy";
import { api, post } from "@/lib/client/api";
import type { CheckView, HoldView, LedgerView, LockView } from "@/lib/views";
import { useFamily, useTabLabel } from "./shell";

// Phase 2 family screens: F2 lock screen, F9a report a link, F12 the monthly note.

// ---------------- F2 · lock-screen alert with Block built in ----------------

/**
 * Arjun's phone, locked and in his pocket. In the simulator this route stands
 * in for the phone's lock screen: the notification shows the newest urgent
 * alert, and "Block payment" works without opening the app. On a real phone
 * the service worker shows the same two buttons on the system notification.
 */
export function LockScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["lock"], queryFn: () => api<LockView>("/api/family/lock"), refetchInterval: 2000 });
  const alert = q.data?.alert ?? null;
  const hold = q.data?.hold ?? null;
  const clock = useCountdown(hold?.status === "pending" ? hold.expiresAt : undefined, q.data?.serverNow, holdTotalMs(hold));
  const [done, setDone] = useState<{ hold: HoldView; who: string } | null>(null);
  const now = useNow(10_000);
  const block = useMutation({
    mutationFn: (holdId: string) => post<HoldView>(`/api/family/holds/${holdId}/decision`, { decision: "block", confirm: false }),
    onSuccess: async (view) => {
      setDone({ hold: view, who: alert?.owner.callName ?? "Papa" });
      await queryClient.invalidateQueries();
    },
  });
  const who = alert?.owner.callName ?? "Papa";
  const minutesLeft = Math.max(0, Math.ceil(clock.left / 60_000));

  const notification = done ? (
    <div className="lock-note" data-testid="lock-blocked">
      <div className="row" style={{ gap: 8 }}>
        <span className="pm" style={{ gap: 3 }}><i /><i /></span>
        <span className="lbl" style={{ color: "#fff" }}>Pause Button</span>
        <span className="grow" />
        <span className="sm" style={{ color: "#B9C4CD" }}>now</span>
      </div>
      <b style={{ fontSize: 20 }}>You blocked it</b>
      <p className="sm" style={{ color: "#ECE8E0" }}>{done.who}&apos;s phone now shows “Payment cancelled”. Nothing left the account.</p>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn white" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => router.push(`/family/hold/${done.hold.id}?call=1`)}>
          Call {done.who}
        </button>
      </div>
    </div>
  ) : alert ? (
    <div className="lock-note" data-testid="lock-alert">
      <div className="row" style={{ gap: 8 }}>
        <span className="pm" style={{ gap: 3 }}><i /><i /></span>
        <span className="lbl" style={{ color: "#fff" }}>Pause Button</span>
        <span className="grow" />
        <span className="sm" style={{ color: "#B9C4CD" }}>{clockTime(alert.createdAt)}</span>
      </div>
      <b style={{ fontSize: 20 }}>{alert.source === "call" ? `${who} is on a scam call` : `${who} got a scam message`}</b>
      <p className="sm" style={{ color: "#ECE8E0" }}>
        {hold && hold.status === "pending"
          ? `${rupees(hold.amount)} is paused. ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left to decide.`
          : alert.source === "call"
            ? "A caller is pressuring them right now."
            : "Nothing is paid. Tell them what to do."}
      </p>
      {hold && hold.status === "pending" ? (
        <div className="row" style={{ gap: 10 }}>
          <button className="btn red" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} disabled={block.isPending} onClick={() => block.mutate(hold.id)}>
            Block payment
          </button>
          <button className="btn whiteline" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => router.push(`/family/hold/${hold.id}?approve=1`)}>
            It&apos;s fine
          </button>
        </div>
      ) : (
        <button className="btn whiteline" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => router.push(`/family/alert/${alert.id}`)}>
          Open
        </button>
      )}
      {block.isError && <p className="sm" style={{ color: "#FFB4AB" }}>{block.error.message}</p>}
    </div>
  ) : (
    <p className="sm center-text" style={{ color: "#B9C4CD" }}>No alerts. Nothing needs you.</p>
  );

  return (
    <Screen tone="ink" bodyStyle={{ color: "#fff", gap: 14 }}>
      <div className="center-text" style={{ marginTop: 18 }}>
        <div className="lbl" style={{ color: "#B9C4CD" }}>{now ? now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase() : ""}</div>
        <div className="display" style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color: "#fff" }}>{now ? clockTime(now.toISOString()) : "--:--"}</div>
      </div>
      {notification}
      <div className="spacer" />
      <p className="sm center-text" style={{ color: "#B9C4CD" }}>
        {done ? "He never unlocked the phone" : "Phone locked · screen was off"}
      </p>
      <button className="ghost" style={{ alignSelf: "center", color: "#fff" }} onClick={() => router.push("/family")}>Unlock</button>
    </Screen>
  );
}

// ---------------- F9a · report a fake link in two taps ----------------

export function ReportLinkScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["family-check", id], queryFn: () => api<CheckView>(`/api/family/checks/${id}`), refetchInterval: 4000 });
  useLeaveIfGone(q.error, "/family");
  const report = useMutation({
    mutationFn: () => post<{ id: string; status: string }>(`/api/family/checks/${id}/report`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["family-check", id] });
      toast({ title: "Reported. Thank you.", sub: "A reviewer checks it before it blocks anything", icon: "flag" });
    },
    onError: (e) => toast({ title: "Not reported", sub: e.message, icon: "warn", tone: "red" }),
  });
  const c = q.data;
  if (!c) return <LoadingScreen />;
  const callName = c.owner.callName;
  const r = c.reportable;
  const brand = r?.reason.match(/“([^”]+)”/)?.[1];

  return (
    <Screen>
      <TitleRow title={`The link in ${callName}'s message`} back={`/family/check/${id}`} />
      {!r ? (
        <div className="card"><b style={{ fontSize: 17 }}>No link to report</b><p className="sm">This message has no web address, or only an official one.</p></div>
      ) : (
        <>
          <div className="card" style={{ gap: 6 }}>
            <div className="row">
              <Icon name="link" />
              <b className="grow" style={{ fontSize: 20, wordBreak: "break-all" }}>{r.domain}</b>
              <span className="tag">{r.status === "lookalike" ? "FAKE SITE" : r.status === "blocked" ? "BLOCKED" : r.protectedSite ? "OFFICIAL" : "UNKNOWN SITE"}</span>
            </div>
            <p className="sm">{brand ? `Pretends to be ${brand}. Not a ${brand} address.` : r.reason}</p>
          </div>
          {r.protectedSite ? (
            <div className="card tint-green">
              <b style={{ fontSize: 17 }}>This is a real, official site</b>
              <p className="sm" style={{ color: "var(--text)" }}>Official bank and government addresses are on a permanent allowlist. They can never be reported or blocked.</p>
            </div>
          ) : r.reported === "none" ? (
            <div className="card" style={{ border: "2px solid var(--text)", gap: 8 }}>
              <b style={{ fontSize: 17 }}>Tell us about this link</b>
              <p className="sm">If you know this is fake, report it. Every other family is protected from it within a minute of a reviewer agreeing.</p>
              <button className="btn red" disabled={report.isPending} onClick={() => report.mutate()} data-testid="report-link">
                <Icon name="flag" />Report this as a fake site
              </button>
            </div>
          ) : (
            <div className={`card ${r.reported === "blocked" ? "tint-red" : r.reported === "rejected" ? "" : "tint-green"}`} style={{ gap: 6 }}>
              <div className="row">
                <span className="ok"><Icon name="check" /></span>
                <b style={{ fontSize: 17 }}>{r.reported === "blocked" ? "Blocked for everyone" : r.reported === "rejected" ? "A reviewer looked and kept it open" : "Reported. Thank you."}</b>
              </div>
              <p className="sm" style={{ color: "var(--text)" }}>
                {r.reported === "blocked"
                  ? "A reviewer agreed. Every family now sees this site as a scam site."
                  : r.reported === "rejected"
                    ? "It did not look like a fake site to the reviewer. Real bank addresses can never be blocked."
                    : "A reviewer checks it before it blocks anything. Real bank addresses can never be blocked."}
              </p>
            </div>
          )}
          <div className="card row-card tint-green">
            <span className="circle" style={{ width: 44, height: 44, background: "#2E7D5B", color: "#fff" }}><Icon name="people" /></span>
            <div className="grow">
              <b style={{ fontSize: 20 }}>{r.familiesProtected} families protected</b>
              <p className="sm" style={{ color: "var(--text)" }}>by reports from people like you this week</p>
            </div>
          </div>
        </>
      )}
      <div className="spacer" />
      <button className="btn line" onClick={() => router.push(`/family/check/${id}`)}>Back to {callName}&apos;s check</button>
    </Screen>
  );
}

// ---------------- F12 · the household ledger and the monthly note ----------------

export function useLedger() {
  return useQuery({ queryKey: ["ledger"], queryFn: () => api<LedgerView>("/api/family/ledger"), refetchInterval: 10_000 });
}

/** F12a · the family home gains a number worth keeping. */
export function LedgerCards({ ledger, me }: { ledger: LedgerView; me: string }) {
  const router = useRouter();
  const { data } = useFamily();
  const several = (data?.people.length ?? 0) > 1;
  if (!ledger.checked && !ledger.paused) return null;
  return (
    <>
      <div className="card" style={{ gap: 10 }} data-testid="ledger">
        <div className="lbl">This month</div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="stat">
            <b>{ledger.paused}</b>
            <span className="sm">payment{ledger.paused === 1 ? "" : "s"} paused</span>
          </div>
          <div className="stat">
            <b style={{ fontSize: 26 }}>{rupeesShort(ledger.heldAmount)}</b>
            <span className="sm">held until you checked</span>
          </div>
        </div>
        <p className="sm">{ledger.checked} message{ledger.checked === 1 ? "" : "s"} checked · {ledger.fine} {ledger.fine === 1 ? "was" : "were"} fine</p>
      </div>
      {ledger.stopped.length > 0 && (
        <div className="card" style={{ gap: 10 }}>
          <div className="lbl">What we stopped</div>
          {ledger.stopped.slice(0, 3).map((s) => (
            <button key={s.holdId} className="row" style={{ background: "transparent", padding: 0, textAlign: "left", color: "inherit" }} onClick={() => router.push(`/family/hold/${s.holdId}`)}>
              <span className="circle" style={{ width: 34, height: 34, background: "#2E7D5B", color: "#fff" }}><Icon name="check" size={18} /></span>
              <div className="grow">
                <b style={{ fontSize: 16 }}>{s.title}</b>
                <p className="sm">
                  {rupees(s.amount)} · {s.by === me ? "you" : s.by} blocked it · {new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {several ? ` · ${s.owner}` : ""}
                </p>
              </div>
              <Icon name="chev" />
            </button>
          ))}
          <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/family/month")}>See your month</button>
        </div>
      )}
    </>
  );
}

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m} minute${m === 1 ? "" : "s"}${rest ? ` ${rest} seconds` : ""}`;
}

/** F12b · the monthly note that keeps the app installed. */
export function MonthScreen() {
  const router = useRouter();
  const toast = useToast();
  const label = useTabLabel();
  const { data } = useFamily();
  const q = useLedger();
  const ledger = q.data;
  if (!data || !ledger) return <LoadingScreen />;
  const me = data.me.name;
  const people = data.people.map((p) => p.callName);
  const whose = people.length === 1 ? `${people[0]}'s` : "the family's";
  const others = ledger.stopped.map((s) => s.by).filter((b) => b !== me);
  const youAnd = others.length ? `You and ${[...new Set(others)].join(" and ")}` : "You";
  const summary = `${rupeesShort(ledger.heldAmount)} stayed in ${whose} account in ${ledger.month}. ${ledger.paused} payment${ledger.paused === 1 ? " was" : "s were"} paused and ${ledger.stopped.length} ${ledger.stopped.length === 1 ? "was" : "were"} stopped. Pause Button.`;

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Your month with Pause Button", text: summary });
        return;
      }
      await navigator.clipboard.writeText(summary);
      toast({ title: "Copied", sub: "Paste it in the family group", icon: "check" });
    } catch {
      toast({ title: "Could not share", sub: "Copy the text above instead", icon: "warn", tone: "red" });
    }
  }

  return (
    <Screen tabs={<FamilyTabs active="home" callName={label} />}>
      <TitleRow title="Your month" back="/family" right={<span className="tag">{ledger.month.toUpperCase()}</span>} />
      <h1 className="h1">{ledger.heldAmount ? `${rupeesShort(ledger.heldAmount)} stayed in ${whose} account` : "Nothing needed stopping this month"}</h1>
      <p className="p">
        {ledger.paused
          ? `${ledger.paused} payment${ledger.paused === 1 ? " was" : "s were"} paused in ${ledger.month.split(" ")[0]}. ${youAnd} stopped ${ledger.stopped.length === ledger.paused ? (ledger.paused === 1 ? "it" : "all of them") : `${ledger.stopped.length} of them`}.`
          : `${ledger.checked} message${ledger.checked === 1 ? "" : "s"} checked, ${ledger.fine} fine. No money was at risk.`}
      </p>
      {ledger.fastest && (
        <div className="card tint-green" style={{ gap: 4 }}>
          <div className="lbl" style={{ color: "var(--green-ink)" }}>The fastest you answered</div>
          <b className="display" style={{ fontSize: 28 }}>{duration(ledger.fastest.ms)}</b>
          <p className="sm" style={{ color: "var(--text)" }}>
            On the {ledger.fastest.title.toLowerCase()}. The scam needed ten minutes of them being alone. They had {ledger.fastest.by === me ? "you" : ledger.fastest.by} in {duration(ledger.fastest.ms)}.
          </p>
        </div>
      )}
      {ledger.area.length > 0 && (
        <div className="card" style={{ gap: 10 }}>
          <div className="lbl">Scams going around your area</div>
          {ledger.area.map((a) => (
            <div className="row" key={a.title}>
              <Icon name="people" />
              <b className="grow" style={{ fontSize: 16 }}>{a.title}</b>
              <span className="sm">{a.households} families this week</span>
            </div>
          ))}
        </div>
      )}
      <div className="spacer" />
      <button className="btn ink" onClick={share}><Icon name="share" />Share this with the family</button>
      <p className="sm center-text">Sent on the first of each month. Turn off any time.</p>
      <button className="ghost" style={{ alignSelf: "center" }} onClick={() => router.push("/family/activity")}>See everything</button>
    </Screen>
  );
}

/** Opens the dialer from a lock-screen "Call Papa" without a second tap. */
export function useCallOnArrival(enabled: boolean, who: string, phone: string | null | undefined) {
  const call = useCall();
  const fired = useRef(false);
  useEffect(() => {
    if (enabled && phone && !fired.current) {
      fired.current = true;
      call(who, phone);
    }
  }, [enabled, phone, call, who]);
}
