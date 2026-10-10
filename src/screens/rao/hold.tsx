"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { clockTime, holdTotalMs, LoadingScreen, Marks, Ring, Screen, TitleRow, useCountdown, useLeaveIfGone } from "@/components/ui";
import { rupees } from "@/lib/check/copy";
import { api, ApiError, post } from "@/lib/client/api";
import { closeNotifications } from "@/lib/client/push";
import type { FamilyReach } from "@/lib/server/checks";
import type { HoldView } from "@/lib/views";
import { HELPLINE } from "@/lib/phone";
import { useHelper, useJoinNames, useT } from "./shell";
import { UnreachableCard, useRaoCall } from "./verdict";

/** H1 waiting · H2 advice · H3 blocked · H4 approved · H5 expired · F13 two keys · F14a unreachable */
export function HoldScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const join = useJoinNames();
  const call = useRaoCall();
  const helper = useHelper();
  const q = useQuery({
    queryKey: ["hold", id],
    queryFn: () => api<{ hold: HoldView; reach: FamilyReach; serverNow: string }>(`/api/me/holds/${id}`),
    refetchInterval: 2000,
  });
  useLeaveIfGone(q.error, "/");
  const hold = q.data?.hold;
  const clock = useCountdown(hold?.expiresAt, q.data?.serverNow, holdTotalMs(hold));
  // He is looking at it: the "Payment cancelled" notification about this payment is no longer needed.
  useEffect(() => {
    void closeNotifications((tag) => tag === `hold-${id}`);
  }, [id]);

  // Seeing the outcome once is enough; the shell stops jumping here after this.
  const seen = useRef(false);
  useEffect(() => {
    if (!hold || seen.current || hold.outcomeSeen) return;
    if (hold.status === "blocked" || hold.status === "approved") {
      seen.current = true;
      void post(`/api/me/holds/${id}/seen`).then(() => queryClient.invalidateQueries({ queryKey: ["rao-state"] }));
    }
  }, [hold, id, queryClient]);

  // F14a · The money screen says what happened: no spinner forever when the app is unreachable.
  if (!hold && q.error instanceof ApiError && q.error.status === 0) {
    return (
      <Screen tone="amber-tint">
        <TitleRow title={t("hold.paused")} back="/" />
        <div className="note"><Icon name="wifi" />{t("common.reconnecting")}</div>
        <div className="card tint-red" style={{ gap: 6 }}>
          <div className="row"><Icon name="wifi" /><b style={{ fontSize: 19 }}>{t("pay.cannotReachApp")}</b></div>
          <p className="sm" style={{ color: "var(--text)" }}>{t("pay.internetDropped")}</p>
        </div>
        <div className="card row-card">
          <Icon name="lock" />
          <div className="grow">
            <b style={{ fontSize: 17 }}>{t("pay.stillHeld")}</b>
            <p className="sm" style={{ color: "var(--text)" }}>{t("pay.neverReleased")}</p>
          </div>
        </div>
        <div className="spacer" />
        <button className="btn amber" onClick={() => void q.refetch()}>{t("common.tryAgain")}</button>
        <button className="btn ink" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
      </Screen>
    );
  }
  if (!hold) return <LoadingScreen title={t("common.loading")} />;
  const status = hold.status === "pending" && clock.expired ? "expired" : hold.status;
  const amount = rupees(hold.amount);
  const decider = hold.decidedByName ?? helper.first;
  const home = () => router.push("/");

  if (status === "blocked" || status === "cancelled") {
    const byMe = status === "cancelled";
    return (
      <Screen tone="green" center bodyStyle={{ gap: 20, color: "#fff" }}>
        <span className="circle" style={{ width: 112, height: 112, background: "#fff", color: "#1F6B49" }}><Icon name="check" size={56} /></span>
        <h1 className="h1" style={{ color: "#fff", fontSize: 38 }}>{t("hold.cancelled")}</h1>
        <p className="p" style={{ fontSize: 22, lineHeight: 1.35 }}>
          {byMe
            ? <>{t("hold.youCancelled1")}<br />{t("hold.youCancelled2")}<br />{t("hold.youCancelled3")}</>
            : <>{t("hold.blocked1", { name: decider })}<br />{t("hold.blocked2")}<br />{t("hold.blocked3")}</>}
        </p>
        {hold.advice[0] && (
          <div className="card" style={{ width: "100%", textAlign: "left" }}>
            <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: hold.advice[0].fromName })}</b></div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>“{hold.advice[0].text}”</p>
          </div>
        )}
        <div className="card" style={{ width: "100%", textAlign: "left" }}>
          <b style={{ fontSize: 18 }}>{t("hold.stayed", { amount })}</b>
          <p className="sm">{byMe ? t("hold.cancelledByYou") : t("hold.blockedBy", { name: decider })}{hold.decidedAt ? t("hold.at", { time: clockTime(hold.decidedAt) }) : ""}</p>
        </div>
        <div style={{ height: 8 }} />
        <button className="btn white" onClick={home}>{t("hold.backHome")}</button>
      </Screen>
    );
  }

  if (status === "approved") {
    const callWho = hold.approvedBy[0] ?? helper.first;
    return (
      <Screen>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <span className="circle" style={{ width: 96, height: 96, background: "var(--ink)", color: "#fff" }}><Icon name="personCheck" size={48} /></span>
        </div>
        <h1 className="h1 center-text">{t("hold.approvedTitle", { name: decider })}</h1>
        <p className="p center-text">{t("hold.approvedBody", { amount })}</p>
        <div className="card tint-amber">
          <b style={{ fontSize: 17 }}>{t("hold.stillNotSure")}</b>
          <p className="sm" style={{ color: "var(--text)" }}>{t("hold.stillSecret", { name: decider })}</p>
        </div>
        <div className="spacer" />
        <button className="btn ink" onClick={home}>{t("common.done")}</button>
        <button className="btn line" onClick={() => call(callWho, helper.phoneOf(callWho))}>{t("common.callName", { name: callWho })}</button>
      </Screen>
    );
  }

  if (status === "expired") {
    return (
      <Screen tone="amber-tint">
        <div className="row"><Icon name="clock" /><span className="lbl" style={{ color: "var(--text)" }}>{t("hold.timeUp")}</span></div>
        <h1 className="h1">{t("hold.stillOnHold")}</h1>
        <p className="p">{t("hold.nobodyAnswered", { n: hold.holdMinutes })}</p>
        <div className="card tint-red">
          <b style={{ fontSize: 17 }}>{t("hold.stillSecretQ")}</b>
          <p className="sm" style={{ color: "var(--text)" }}>{t("hold.scamSign")}</p>
        </div>
        <div className="spacer" />
        <button className="btn red" onClick={() => call(t("common.helplineName"), HELPLINE)}>{t("common.helpline")}</button>
        <button className="btn ink" onClick={() => call(helper.first, helper.phone)}>{t("common.callName", { name: helper.first })}</button>
        <button className="btn line" onClick={home}>{t("hold.startAgain")}</button>
      </Screen>
    );
  }

  // pending: H1 (waiting) or H2 (advice arrived)
  const advice = hold.advice[0];
  return (
    <Screen tone="amber">
      <div className="row"><Icon name="lock" /><span className="lbl" style={{ color: "#14202B" }}>{t("hold.paused")}</span></div>
      <Ring fraction={clock.fraction} label={clock.label} sub={t("hold.minutesLeft")} />
      <h1 className="h2 center-text">{t("hold.onHold", { amount })}</h1>
      {hold.twoKeys && (
        <div className="card" style={{ border: "2px solid #14202B", gap: 4 }} data-testid="two-keys">
          <div className="row"><Icon name="people" /><b style={{ fontSize: 17 }}>{t("hold.twoKeys")}</b></div>
          <p className="sm" style={{ color: "var(--text)" }}>{t("hold.twoKeysBody", { minutes: hold.holdMinutes })}</p>
        </div>
      )}
      <div className="card">
        <div className="lbl">{t("hold.whatTold", { name: helper.first })}</div>
        <Marks phrases={hold.phrases} />
      </div>
      {hold.approvedBy.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", gap: 6 }}>
          <b style={{ fontSize: 18 }}>{t("hold.approved", { names: join(hold.approvedBy) })}</b>
          <p className="sm" style={{ color: "var(--text)" }}>{t("hold.waitingEveryone", { names: join(hold.waitingFor) })}</p>
        </div>
      )}
      {advice ? (
        <div className="card tint-green" style={{ border: "2px solid #2E7D5B", padding: "12px 16px", gap: 6 }}>
          <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: advice.fromName })}</b></div>
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{advice.text}”</p>
        </div>
      ) : hold.approvedBy.length ? null : (
        <div className="card row-card" style={{ padding: "12px 16px" }}>
          <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)", width: 14, height: 14 }} />
          <div className="grow">
            <b style={{ fontSize: 18 }}>{t("hold.waitingFamily")}</b>
            <p className="sm" style={{ color: "var(--text)" }}>
              {helper.all.length ? (helper.all.length > 1 ? t("hold.wereAlerted", { names: join(helper.all) }) : t("hold.wasAlerted", { names: helper.all[0] })) : t("hold.addTrusted")}
            </p>
          </div>
        </div>
      )}
      {q.data?.reach && <UnreachableCard names={q.data.reach.unreachableNames} nobody={q.data.reach.nobodyReached} withCall={false} />}
      <div className="spacer" />
      <button className="btn ink" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
      <button className="btn line" onClick={() => call(t("common.helplineName"), HELPLINE)}>{t("common.helpline")}</button>
      <p className="sm center-text" style={{ color: "#14202B" }}>{t("hold.noPayButton", { name: helper.first })}</p>
    </Screen>
  );
}
