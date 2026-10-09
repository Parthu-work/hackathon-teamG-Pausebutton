"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, HighlightedText, holdTotalMs, LoadingScreen, Marks, Screen, SignalBars, SignalRows, useCall, useCountdown, useToast, VerdictPill, type SignalWords } from "@/components/ui";
import { rupees } from "@/lib/check/copy";
import { keyPhrases } from "@/lib/check/phrases";
import { SIGNAL_TYPES, type SignalType } from "@/lib/check/types";
import { bcp47 } from "@/lib/i18n";
import { api, post } from "@/lib/client/api";
import { loadMessage } from "@/lib/client/messages";
import { closeNotifications } from "@/lib/client/push";
import { canSpeak, speak, stopSpeaking } from "@/lib/client/speech";
import type { CheckView } from "@/lib/views";
import { HELPLINE } from "@/lib/phone";
import { appLabel } from "./share";
import { useHelper, useJoinNames, useLang, useT } from "./shell";

export function useCheck(id: string) {
  return useQuery({ queryKey: ["check", id], queryFn: () => api<CheckView>(`/api/me/checks/${id}`), refetchInterval: 3000 });
}

/** The words on the signal rows, in Mr Rao's language. */
export function useSignalWords(): SignalWords {
  const t = useT();
  return {
    labels: Object.fromEntries(SIGNAL_TYPES.map((s) => [s, t(`signal.${s}`)])) as Record<SignalType, string>,
    notFound: t("verdict.notFound"),
    words: t("verdict.words"),
    link: t("verdict.link"),
    unknownSite: t("verdict.unknownSite"),
    scamSite: t("verdict.scamSite"),
    fakeSite: t("verdict.fakeSite"),
  };
}

export function useRaoCall() {
  const t = useT();
  return useCall({ noNumber: t("common.noNumber"), addNumber: t("common.addNumber"), callShows: t("common.callShows"), onPhoneDialer: t("common.onPhoneDialer") });
}

/** "3 days ago" / "yesterday" / "today" */
function whenText(t: ReturnType<typeof useT>, iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return days <= 0 ? t("verdict.today") : days === 1 ? t("verdict.yesterday") : t("verdict.daysAgo", { n: days });
}

/** F10a · the verdict reads itself aloud. */
function ReadAloud({ text }: { text: string }) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<"idle" | "speaking" | "unsupported">("idle");
  useEffect(() => () => stopSpeaking(), []);
  if (state === "unsupported") return <p className="sm">{t("verdict.noSpeech")}</p>;
  return (
    <>
      <button
        className={`btn ${state === "speaking" ? "ink" : "line"} sm-btn`}
        style={{ alignSelf: "flex-start", width: "auto" }}
        aria-pressed={state === "speaking"}
        onClick={() => {
          if (state === "speaking") {
            stopSpeaking();
            setState("idle");
            return;
          }
          if (!canSpeak() || !speak(text, bcp47(lang), () => setState("idle"))) {
            setState("unsupported");
            return;
          }
          setState("speaking");
        }}
      >
        <Icon name="speaker" size={20} />
        {state === "speaking" ? t("verdict.stopReading") : t("verdict.readAloud")}
      </button>
      {state === "speaking" && (
        <div className="card tint-amber" style={{ gap: 4 }}>
          <div className="lbl" style={{ color: "var(--text)" }}>{t("verdict.readingToYou")}</div>
          <p className="p" style={{ fontSize: 17 }}>“{text}”</p>
        </div>
      )}
    </>
  );
}

/** F3a · "47 other families got this today": the verdict stops being personal. */
function CampaignCard({ c }: { c: CheckView }) {
  const t = useT();
  if (!c.campaign) return null;
  return (
    <>
      <div className="card" style={{ border: "2px solid var(--text)", gap: 6 }} data-testid="campaign">
        <div className="row"><Icon name="people" /><b style={{ fontSize: 18 }}>{t("verdict.otherFamilies", { n: c.campaign.households })}</b></div>
        <p className="p" style={{ fontSize: 16 }}>{t("verdict.campaignBody", { n: c.campaign.households })}</p>
        <span className="tag a" style={{ alignSelf: "flex-start" }}>
          {c.campaign.spreading ? t("verdict.spreading", { when: whenText(t, c.campaign.firstSeenAt) }) : t("verdict.firstSeen", { when: whenText(t, c.campaign.firstSeenAt) })}
        </span>
      </div>
      <div className="card" style={{ gap: 4 }}>
        <b style={{ fontSize: 16 }}>{t("verdict.howWeKnow")}</b>
        <p className="sm">{t("verdict.howWeKnowBody")}</p>
      </div>
    </>
  );
}

/**
 * The alert has not reached someone (see FamilyReach on the server) and they
 * have not opened it: say so, and offer the call, so he does not sit waiting
 * for an answer that is not coming. When nobody was reached, say that plainly.
 * The hold screen has its own call buttons, so it leaves this one out.
 */
export function UnreachableCard({ names, nobody, withCall = true }: { names: string[]; nobody: boolean; withCall?: boolean }) {
  const t = useT();
  const join = useJoinNames();
  const helper = useHelper();
  const call = useRaoCall();
  if (!names.length) return null;
  const first = names[0];
  return (
    <div className={`card ${nobody ? "tint-red" : "tint-amber"}`} style={{ gap: 8 }} data-testid={nobody ? "nobody-reached" : "unreachable"}>
      <div className="row"><Icon name="warn" /><b className="grow" style={{ fontSize: 17 }}>{nobody ? t("verdict.nobodyTitle") : t("verdict.unreachableTitle", { names: join(names) })}</b></div>
      <p className="sm" style={{ color: "var(--text)" }}>{nobody ? t("verdict.nobodyBody", { names: join(names), first }) : t("verdict.unreachableBody", { names: join(names) })}</p>
      {withCall && (
        <button className="btn ink" style={{ minHeight: 48 }} onClick={() => call(first, helper.phoneOf(first))}>
          <Icon name="phone" />{t("common.callName", { name: first })}
        </button>
      )}
    </div>
  );
}

/** F1b/F8/F10 · "What they asked for": the payment and secrecy phrases, as a sentence. */
function WhatAsked({ c }: { c: CheckView }) {
  const t = useT();
  const payment = c.signals.find((s) => s.type === "payment");
  const secrecy = c.signals.find((s) => s.type === "secrecy");
  if (!payment && !secrecy) return null;
  return (
    <div className="card" style={{ gap: 4 }}>
      <div className="lbl">{t("verdict.whatAsked")}</div>
      <p className="p" style={{ fontSize: 17, lineHeight: 1.5 }}>
        {payment && <mark>{payment.phrase}</mark>}
        {payment && secrecy && ` ${t("common.and")} `}
        {secrecy && <mark>{secrecy.phrase}</mark>}
      </p>
    </div>
  );
}

/** E1 · SCAM · E2 · SUSPICIOUS · E3 · SAFE · N3 · detected message detail · F1b/F3a/F8 */
export function VerdictScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const join = useJoinNames();
  const words = useSignalWords();
  const call = useRaoCall();
  const toast = useToast();
  const helper = useHelper();
  const { data: c, error } = useCheck(id);
  const [dismissed, setDismissed] = useState(false);
  const holdClock = useCountdown(c?.hold?.status === "pending" ? c.hold.expiresAt : undefined, rao.data?.serverNow, holdTotalMs(c?.hold));
  // He is looking at it: the "Possible scam from …" notification about this message is no longer needed.
  useEffect(() => {
    void closeNotifications((tag) => tag === `check-${id}`);
  }, [id]);

  if (error) {
    return (
      <Screen>
        <h1 className="h1">{t("verdict.couldNotOpen")}</h1>
        <p className="p">{error.message}</p>
        <button className="btn ink" onClick={() => router.push("/")}>{t("verdict.backHome")}</button>
      </Screen>
    );
  }
  if (!c) return <LoadingScreen title={t("common.loading")} />;

  const detected = c.source === "sms" || c.source === "whatsapp";
  const forwarded = c.source === "share";
  const spoken = c.source === "voice";
  const fromCall = c.source === "call";
  const asked = !!c.askedFamilyAt;
  const alerted = c.alertedNames.length > 0;
  const text = c.simText ?? c.messageText ?? loadMessage(id);
  const verdictLabel = (v: "SCAM" | "SUSPICIOUS" | "SAFE") => t(`verdictLabel.${v}`);

  async function ask() {
    await post(`/api/me/checks/${id}/ask`, { text: loadMessage(id) ?? undefined });
    await queryClient.invalidateQueries({ queryKey: ["check", id] });
    toast({ title: t("verdict.askedToast", { name: helper.first }), sub: t("verdict.answerShows"), icon: "bell" });
  }

  const who = c.familyVerdictByName ?? helper.first;
  const familyAnswer = c.familyVerdict === "scam" && (
    <div className="card tint-red" style={{ border: "2px solid #C6372B" }}>
      <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: who })}</b></div>
      <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>{t("verdict.scamDoNot")}</p>
      {c.advice[0] && <p className="sm" style={{ color: "var(--text)" }}>“{c.advice[0].text}”</p>}
    </div>
  );

  // Answers so far, while not everyone has answered (any "scam" would already have settled it).
  const answersCard = !c.familyVerdict && c.answers.length > 0 && (
    <div className="card" style={{ border: "2px solid var(--text)", gap: 10 }}>
      <div className="lbl" style={{ color: "var(--text)" }}>{t("verdict.familyAnswers")}</div>
      {c.answers.map((a) => (
        <div className="row" key={a.memberId}>
          <span className="dot" style={{ background: a.verdict === "scam" ? "#C6372B" : "#2E7D5B" }} />
          <span className="grow" style={{ fontSize: 16, fontWeight: 700 }}>{a.verdict === "scam" ? t("verdict.isScam", { name: a.name }) : t("verdict.isNotScam", { name: a.name })}</span>
          <span className="sm">{clockTime(a.at)}</span>
        </div>
      ))}
      {c.waitingFor.map((n) => (
        <div className="row" key={n}>
          <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)" }} />
          <span className="grow" style={{ fontSize: 16, fontWeight: 700 }}>{t("common.waitingFor", { names: n })}</span>
        </div>
      ))}
      <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.safeOnlyWhenAll")}</p>
    </div>
  );

  const adviceCard = !c.familyVerdict && c.advice[0] && (
    <div className="card tint-green" style={{ border: "2px solid #2E7D5B" }}>
      <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: c.advice[0].fromName })}</b></div>
      <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{c.advice[0].text}”</p>
    </div>
  );

  const sourceRow = detected ? (
    <div className="card row-card" style={{ padding: "10px 14px" }}>
      <span className="src"><Icon name="msg" /></span>
      <div className="grow">
        <div className="lbl">{t("verdict.detectedOn")}</div>
        <b style={{ fontSize: 16 }}>{c.source === "sms" ? "SMS" : "WhatsApp"} · {c.senderLabel}</b>
      </div>
      <span className="sm">{clockTime(c.createdAt)}</span>
    </div>
  ) : null;

  const degradedNote = c.degraded && (
    <div className="note" style={{ margin: "0 0 4px" }}><Icon name="info" />{t("verdict.rulesOnly")}</div>
  );

  const pills = (verdict: "SCAM" | "SUSPICIOUS" | "SAFE") => (
    <div className="row wrap" style={{ gap: 8 }}>
      <VerdictPill verdict={verdict} label={verdictLabel(verdict)} />
      {forwarded && <span className="tag a">{t("verdict.forwardedFrom", { app: appLabel(c.senderLabel).toUpperCase() })}</span>}
      {spoken && <span className="tag">{t("verdict.spoken")}</span>}
      {fromCall && <span className="tag">{t("verdict.liveCall")}</span>}
      {c.novel && <span className="tag a" data-testid="new-trick">{t("verdict.newTrick")}</span>}
    </div>
  );

  const top = (
    <>
      {degradedNote}
      <button className="back" onClick={() => router.push(detected ? "/inbox" : "/")}>
        <Icon name="back" />
        <span>{detected ? t("verdict.backMessages") : t("verdict.checkAnother")}</span>
      </button>
      {sourceRow}
    </>
  );

  // F6 · the live-call guard: what he told us, instead of a message.
  const callCard = fromCall && c.callAnswers && (
    <div className="card" style={{ gap: 8 }}>
      <div className="lbl">{t("verdict.whatYouTold")}</div>
      {(["video", "money", "secrecy"] as const).map((k) => (
        <div className="row" key={k}>
          <span className={c.callAnswers![k] ? "no-icon" : "ok"}><Icon name={c.callAnswers![k] ? "x" : "check"} /></span>
          <span className="grow" style={{ fontSize: 16, fontWeight: 700 }}>{t(k === "video" ? "verdict.callVideo" : k === "money" ? "verdict.callMoney" : "verdict.callSecrecy")}</span>
          <span className="tag">{c.callAnswers![k] ? t("verdict.callYes") : t("verdict.callNo")}</span>
        </div>
      ))}
    </div>
  );

  // ---------- family said "not a scam": their answer decides what he sees ----------
  if (c.familyVerdict === "not_scam") {
    const notes = c.advice.slice(0, 2);
    const flagged = c.verdict !== "SAFE";
    const callWho = c.answers.find((a) => a.verdict === "not_scam")?.name ?? helper.first;
    return (
      <Screen>
        {top}
        <div className="row" style={{ gap: 10 }}>
          <VerdictPill verdict="SAFE" label={verdictLabel("SAFE")} />
          <span className="tag g">{t("verdict.checkedByTag", { name: who.toUpperCase() })}</span>
        </div>
        <h1 className="h1">{t("verdict.notScamTitle", { name: who })}</h1>
        <p className="p">{t("verdict.notScamBody", { who: c.answers.length > 1 ? t("verdict.everyoneYouTrust") : who, flagged: flagged ? t("verdict.andWarnings") : "" })}</p>
        {notes.map((note) => (
          <div key={note.id} className="card tint-green" style={{ border: "2px solid #2E7D5B" }}>
            <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: note.fromName })}</b></div>
            <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{note.text}”</p>
          </div>
        ))}
        <div className="lbl">{flagged ? t("verdict.whatFlagged") : t("verdict.whatFound")}</div>
        <SignalRows signals={c.signals} link={c.link} modelTerms={c.modelTerms} words={words} />
        <div className="card tint-amber">
          <b style={{ fontSize: 17 }}>{t("verdict.stillNotSure")}</b>
          <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.stillNotSureBody", { name: who })}</p>
        </div>
        <div className="spacer" />
        <button className="btn green" onClick={() => router.push(detected ? "/inbox" : "/")}>{t("common.done")}</button>
        <button className="btn line" onClick={() => call(callWho, helper.phoneOf(callWho))}><Icon name="phone" />{t("common.callName", { name: callWho })}</button>
        {flagged && (
          <button className="ghost" style={{ alignSelf: "center" }} onClick={() => router.push(`/check/${id}/why`)}>{t("verdict.whyFlagged")}</button>
        )}
      </Screen>
    );
  }

  // ---------- SCAM (found by the check, or family said so) ----------
  if (c.verdict === "SCAM" || c.familyVerdict === "scam") {
    const byFamily = c.verdict !== "SCAM";
    const headline = byFamily ? t("verdict.saysScam", { name: who }) : detected ? t("verdict.doNotReplyClick") : c.headline;
    const body = byFamily
      ? t("verdict.familyDoesNotTrust", { name: who })
      : detected
        ? c.body
        : c.novel
          ? t("verdict.novelBody")
          : `${c.body}${alerted ? t("verdict.alreadyTold") : ""}`;
    const alertedLine = detected
      ? c.alertedNames.length > 1 ? t("verdict.wereTold", { names: join(c.alertedNames) }) : t("verdict.wasTold", { names: join(c.alertedNames) })
      : c.alertedNames.length > 1 ? t("verdict.wereAlerted", { names: join(c.alertedNames) }) : t("verdict.wasAlerted", { names: join(c.alertedNames) });
    return (
      <Screen>
        {top}
        {pills("SCAM")}
        <h1 className="h1">{headline}</h1>
        <p className="p">{body}</p>
        <ReadAloud text={`${headline} ${body}`} />
        {callCard}
        {c.novel && text ? (
          <>
            <div className="card" style={{ gap: 6 }}>
              <div className="lbl">{t("verdict.wordsGaveAway")}</div>
              <HighlightedText text={text} signals={c.signals} link={c.link} />
              <p className="sm">{t("verdict.foundByAi")}</p>
            </div>
            <div className="card tint-amber" style={{ gap: 4 }}>
              <b style={{ fontSize: 16 }}>{t("verdict.noRules")}</b>
              <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.noRulesBody")}</p>
            </div>
          </>
        ) : (
          <>
            {(forwarded || spoken) && <WhatAsked c={c} />}
            <div className="lbl">{t("verdict.whatDoes")}</div>
            <SignalBars signals={c.signals} labels={words.labels} />
            <SignalRows signals={c.signals} link={c.link} modelTerms={c.modelTerms} words={words} />
          </>
        )}
        <CampaignCard c={c} />
        {!byFamily && familyAnswer}
        {answersCard}
        {byFamily && c.advice[0] && (
          <div className="card tint-red" style={{ border: "2px solid #C6372B" }}>
            <div className="row"><Icon name="msg" /><b style={{ fontSize: 16 }}>{t("verdict.says", { name: c.advice[0].fromName })}</b></div>
            <p style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 800 }}>“{c.advice[0].text}”</p>
          </div>
        )}
        {adviceCard}
        {c.hold && c.hold.status === "pending" && (
          <Link href={`/hold/${c.hold.id}`} className="card row-card tint-amber" style={{ textDecoration: "none" }}>
            <Icon name="lock" />
            <div className="grow">
              <b style={{ fontSize: 17 }}>{t("verdict.paymentPaused", { amount: rupees(c.hold.amount) })}</b>
              <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.leftNothingPaid", { time: holdClock.label })}</p>
            </div>
            <Icon name="chev" />
          </Link>
        )}
        {alerted && (
          <div className="card row-card tint-green">
            <span className="circle" style={{ width: 34, height: 34, background: "#2E7D5B", color: "#fff" }}><Icon name="check" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: 17 }}>{c.novel ? t("verdict.toldAnyway", { names: join(c.alertedNames) }) : alertedLine}</b>
              <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.sentAuto", { time: clockTime(c.createdAt) })}</p>
            </div>
          </div>
        )}
        <UnreachableCard names={c.unreachableNames} nobody={c.nobodyReached} />
        <div className="spacer" />
        {detected ? (
          <button className="btn ink" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
        ) : (
          <button className="btn amber" onClick={() => router.push(`/check/${id}/todo`)}>{t("verdict.whatToDo")}</button>
        )}
        <button className="btn line" onClick={() => router.push(`/check/${id}/why`)}>{t("verdict.whyWeThink")}</button>
        {!alerted && !asked && <button className="btn line" onClick={ask}><Icon name="bell" />{t("verdict.tell", { name: helper.first })}</button>}
        <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
          <button className="ghost" onClick={() => call(t("common.helplineName"), HELPLINE)}>{t("common.helpline")}</button>
          {c.amount && (!c.hold || c.hold.status === "cancelled") && c.familyVerdict !== "scam" && (
            <button className="ghost" onClick={() => router.push(`/check/${id}/pay`)}>{t("verdict.payAnyway")}</button>
          )}
          {detected && !dismissed && (
            <button className="ghost" onClick={() => { setDismissed(true); toast({ title: t("verdict.noted"), sub: t("verdict.ifUnsureAsk", { name: helper.first }), icon: "info" }); }}>
              {t("verdict.notAScamBtn")}
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
        {pills("SUSPICIOUS")}
        <h1 className="h1">{c.headline}</h1>
        <p className="p">{c.body}</p>
        <ReadAloud text={`${c.headline} ${c.body}`} />
        {callCard}
        <div className="lbl">{t("verdict.whatDoes")}</div>
        <SignalBars signals={c.signals} amber labels={words.labels} />
        <SignalRows signals={c.signals} link={c.link} modelTerms={c.modelTerms} words={words} />
        <CampaignCard c={c} />
        {adviceCard}
        {answersCard}
        {asked && !c.answers.length && (
          <div className="card row-card" style={{ padding: "12px 16px" }}>
            <span className="dot" style={{ background: "#F2A900", border: "2px solid var(--text)", width: 14, height: 14 }} />
            <div className="grow">
              <b style={{ fontSize: 18 }}>{t("common.waitingFor", { names: join(c.waitingFor.length ? c.waitingFor : [helper.first]) })}</b>
              <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.waitingAsked", { time: clockTime(c.askedFamilyAt!) })}</p>
            </div>
          </div>
        )}
        <UnreachableCard names={c.unreachableNames} nobody={c.nobodyReached} />
        <div className="spacer" />
        {asked ? (
          <button className="btn ink" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
        ) : (
          <button className="btn ink" onClick={ask}><Icon name="bell" />{t("verdict.ask", { name: helper.first })}</button>
        )}
        <button className="btn line" onClick={() => router.push(`/check/${id}/why`)}>{t("verdict.whyWeThink")}</button>
        <p className="sm center-text">{t("verdict.dontTapUntil", { name: helper.first })}</p>
        {c.amount && (!c.hold || c.hold.status === "cancelled") && (
          <button className="ghost" style={{ alignSelf: "center" }} onClick={() => router.push(`/check/${id}/pay`)}>{t("verdict.payAnyway")}</button>
        )}
      </Screen>
    );
  }

  // ---------- SAFE ----------
  return (
    <Screen>
      {top}
      {pills("SAFE")}
      <h1 className="h1">{c.headline}</h1>
      <p className="p">{c.body}</p>
      <ReadAloud text={`${c.headline} ${c.body}`} />
      <div className="lbl">{t("verdict.whatDoes")}</div>
      <SignalBars signals={c.signals} labels={words.labels} />
      <SignalRows signals={c.signals} link={c.link} words={words} />
      {answersCard}
      <div className="card tint-green">
        <p className="sm" style={{ color: "var(--text)" }}>{t("verdict.safeMeans")}</p>
      </div>
      <div className="spacer" />
      <button className="btn green" onClick={() => router.push(detected ? "/inbox" : "/")}>{t("common.done")}</button>
      {!asked ? (
        <button className="btn line" onClick={ask}>{t("verdict.askAnyway", { name: helper.first })}</button>
      ) : (
        <p className="sm center-text">{t("verdict.hasBeenAsked", { name: helper.first })}</p>
      )}
    </Screen>
  );
}

/** G1 · STOP: strict notice shown first when a SCAM is found */
export function StopScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const join = useJoinNames();
  const call = useRaoCall();
  const helper = useHelper();
  const { data: c } = useCheck(id);
  const alerted = c?.alertedNames ?? [];
  const items: [string, "x" | "link" | "phone" | "shield"][] = [
    [t("stop.noPay"), "x"],
    [t("stop.noLink"), "link"],
    [t("stop.noCallBack"), "phone"],
    [t("stop.noOtp"), "shield"],
  ];
  return (
    <Screen tone="red" bodyStyle={{ color: "#fff", gap: 10 }}>
      <span className="lbl center-text" style={{ color: "#fff", fontSize: 14 }}>{t("stop.detected")}</span>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span className="circle" style={{ width: 92, height: 92, background: "#fff", color: "#B3291E" }}>
          <Icon name="octagon" size={48} />
        </span>
      </div>
      <h1 className="h1 center-text" style={{ color: "#fff", fontSize: 46 }}>{t("stop.stop")}</h1>
      <p className="p center-text" style={{ color: "#fff", fontSize: 21, fontWeight: 800, lineHeight: 1.25 }}>{t("stop.doNothing")}</p>
      {items.map(([label, icon]) => (
        <div key={label} className="row" style={{ background: "rgba(255,255,255,.14)", borderRadius: 14, padding: "12px 14px" }}>
          <span className="circle" style={{ width: 34, height: 34, background: "#fff", color: "#B3291E" }}><Icon name={icon} size={20} /></span>
          <b style={{ fontSize: 19, lineHeight: 1.2, color: "#fff" }}>{label}</b>
        </div>
      ))}
      <p className="sm center-text" style={{ color: "#fff", fontSize: 15 }}>
        {alerted.length ? (alerted.length > 1 ? t("stop.haveBeenTold", { names: join(alerted) }) : t("stop.hasBeenTold", { names: alerted[0] })) : t("stop.callTrusted")}
      </p>
      <div className="spacer" />
      <button className="btn white" onClick={() => router.replace(`/check/${id}`)} data-testid="stop-continue">{t("stop.iWillNot")}</button>
      <button className="btn whiteline md-btn" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
    </Screen>
  );
}

/** The phrases family was shown, for screens that need them without a message. */
export function phrasesOf(c: CheckView, max = 5) {
  return keyPhrases(c.signals, c.link, c.hardPhrases, max);
}

export { Marks };
