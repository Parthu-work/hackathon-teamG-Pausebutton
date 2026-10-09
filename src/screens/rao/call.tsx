"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { LoadingScreen, Screen, TitleRow, useCall, useToast } from "@/components/ui";
import type { CallAnswers } from "@/lib/check/types";
import { ApiError, post } from "@/lib/client/api";
import { HELPLINE } from "@/lib/phone";
import { useHelper, useJoinNames, useT } from "./shell";
import { useCheck } from "./verdict";

// F6 · Live-call guard: the scam with no message. Three large questions,
// answerable while panicking, then HANG UP and the family is told.

const QUESTIONS = ["video", "money", "secrecy"] as const;

/** F6b · Three large questions, one per screen. */
export function CallScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const toast = useToast();
  const helper = useHelper();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<CallAnswers>>({});
  const [busy, setBusy] = useState(false);
  const q = QUESTIONS[step];
  const left = QUESTIONS.length - step - 1;

  async function answer(value: boolean) {
    const next = { ...answers, [q]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ checkId: string }>("/api/me/calls", { video: !!next.video, money: !!next.money, secrecy: !!next.secrecy });
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      router.replace(`/call/${r.checkId}`);
    } catch (e) {
      setBusy(false);
      toast({ title: t("call.couldNotTell"), sub: e instanceof ApiError ? e.message : String(e), icon: "warn", tone: "red" });
    }
  }

  return (
    <Screen>
      <TitleRow title={t("call.whileOnLine")} back={step === 0 ? "/" : () => setStep(step - 1)} right={<span className="tag">{t("call.step", { i: step + 1 })}</span>} />
      <div className="prog">{QUESTIONS.map((k, i) => <b key={k} className={i <= step ? "on" : ""} />)}</div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <span className="circle" style={{ width: 84, height: 84, background: "var(--ink)", color: "#fff" }}>
          <Icon name={q === "video" ? "video" : q === "money" ? "rupee" : "lock"} size={40} />
        </span>
      </div>
      <h1 className="h1 center-text" style={{ fontSize: 32 }}>{t(`call.q${step + 1}` as "call.q1" | "call.q2" | "call.q3")}</h1>
      <p className="p center-text">{t(`call.q${step + 1}sub` as "call.q1sub" | "call.q2sub" | "call.q3sub")}</p>
      <button className="btn red big" disabled={busy} onClick={() => answer(true)}>{q === "video" ? t("call.yesVideo") : t("call.yes")}</button>
      <button className="btn line big" disabled={busy} onClick={() => answer(false)}>{q === "video" ? t("call.noVideo") : t("call.no")}</button>
      <div className="card tint-amber" style={{ gap: 4 }}>
        <b style={{ fontSize: 16 }}>{busy ? t("call.telling", { name: helper.first }) : t("call.stayCalm")}</b>
        <p className="sm" style={{ color: "var(--text)" }}>
          {left > 1 ? t("call.moreQuestions", { n: left, name: helper.first }) : left === 1 ? t("call.oneMore", { name: helper.first }) : t("call.telling", { name: helper.first })}
        </p>
      </div>
    </Screen>
  );
}

/** F6c · HANG UP: the verdict, and the family alert already fired. */
export function CallVerdictScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const join = useJoinNames();
  const helper = useHelper();
  const call = useCall({ noNumber: t("common.noNumber"), addNumber: t("common.addNumber"), callShows: t("common.callShows"), onPhoneDialer: t("common.onPhoneDialer") });
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen />;
  const alerted = c.alertedNames;

  if (c.verdict !== "SCAM") {
    return (
      <Screen tone="amber-tint">
        <div className="row"><Icon name="warn" /><span className="lbl" style={{ color: "var(--text)" }}>{t("call.careful")}</span></div>
        <h1 className="h1">{t("call.unsureTitle")}</h1>
        <p className="p">{t("call.unsureBody")}</p>
        <div className="card tint-red">
          <p className="sm" style={{ color: "var(--text)" }}>{t("call.askBeforePay", { name: helper.first })}</p>
        </div>
        <div className="spacer" />
        <button className="btn ink" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
        <button className="btn line" onClick={() => router.push(`/check/${id}`)}>{t("call.iHungUp")}</button>
        <button className="ghost" style={{ alignSelf: "center" }} onClick={() => call(t("common.helplineName"), HELPLINE)}>{t("common.helpline")}</button>
      </Screen>
    );
  }

  return (
    <Screen tone="red" bodyStyle={{ color: "#fff", gap: 10 }}>
      <span className="lbl center-text" style={{ color: "#fff", fontSize: 14 }}>{t("call.fakeOfficer")}</span>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span className="circle" style={{ width: 92, height: 92, background: "#fff", color: "#B3291E" }}>
          <Icon name="hangup" size={52} />
        </span>
      </div>
      <h1 className="h1 center-text" style={{ color: "#fff", fontSize: 46 }}>{t("call.hangUp")}</h1>
      <p className="p center-text" style={{ color: "#fff", fontSize: 20, fontWeight: 800, lineHeight: 1.25 }}>{t("call.neverVideo")}</p>
      {[
        [t("call.putDown"), "phone"],
        [t("call.noMoney"), "x"],
      ].map(([label, icon]) => (
        <div key={label} className="row" style={{ background: "rgba(255,255,255,.14)", borderRadius: 14, padding: "12px 14px" }}>
          <span className="circle" style={{ width: 34, height: 34, background: "#fff", color: "#B3291E" }}><Icon name={icon as "phone" | "x"} size={20} /></span>
          <b style={{ fontSize: 19, lineHeight: 1.2, color: "#fff" }}>{label}</b>
        </div>
      ))}
      {alerted.length > 0 && (
        <div className="row" style={{ background: "#fff", color: "#14202B", borderRadius: 14, padding: "12px 14px" }}>
          <span className="circle" style={{ width: 34, height: 34, background: "#2E7D5B", color: "#fff" }}><Icon name="bell" size={20} /></span>
          <div className="grow">
            <b style={{ fontSize: 17, lineHeight: 1.2 }}>{t("call.calling", { name: alerted[0] })}</b>
            <p className="sm">{alerted.length > 1 ? t("call.haveBeenTold", { names: join(alerted) }) : t("call.hasBeenTold", { names: alerted[0] })}</p>
          </div>
        </div>
      )}
      <div className="spacer" />
      <button className="btn white" onClick={() => router.replace(`/check/${id}`)}>{t("call.iHungUp")}</button>
      <button className="btn whiteline md-btn" onClick={() => call(t("common.helplineName"), HELPLINE)}><Icon name="phone" />{t("common.helpline")}</button>
    </Screen>
  );
}
