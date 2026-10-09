"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { HighlightedText, LoadingScreen, Marks, Screen, TitleRow, holdTotalMs, useCountdown, useToast, VerdictPill } from "@/components/ui";
import { DO_LIST, DONT_LIST, rupees } from "@/lib/check/copy";
import { keyPhrases } from "@/lib/check/phrases";
import type { HardRule, SignalType } from "@/lib/check/types";
import { ApiError, post } from "@/lib/client/api";
import { loadMessage } from "@/lib/client/messages";
import { HELPLINE } from "@/lib/phone";
import type { HoldStatus } from "@/lib/views";
import { useHelper, useJoinNames, useLang, useRao, useT } from "./shell";
import { useCheck, useRaoCall } from "./verdict";

const FLOOR_KEY: Record<HardRule, "why.floorSecrecy" | "why.floorCredential" | "why.floorLink" | "why.floorCall"> = {
  secrecy_payment: "why.floorSecrecy",
  credential_request: "why.floorCredential",
  bad_link: "why.floorLink",
  live_call: "why.floorCall",
};

/** F1 · Why it is a scam · F3 · rules only */
export function WhyScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen title={t("common.loading")} />;

  const text = c.simText ?? c.messageText ?? loadMessage(id);
  const order: SignalType[] = [];
  [...c.signals].sort((a, b) => a.start - b.start).forEach((s) => !order.includes(s.type) && order.push(s.type));
  (["authority", "fear", "secrecy", "payment"] as SignalType[]).forEach((s) => !order.includes(s) && order.push(s));
  const numbers = new Map<SignalType, number>();
  let n = 0;
  order.forEach((s) => c.signals.some((x) => x.type === s) && numbers.set(s, ++n));
  const noAi = c.degraded;
  const verdictLabel = t(`verdictLabel.${c.finalVerdict}`);

  return (
    <Screen note={noAi ? <div className="note" style={{ margin: "12px 20px 0" }}><Icon name="info" />{t("verdict.rulesOnly")}</div> : undefined}>
      <TitleRow
        title={c.familyVerdict === "not_scam" ? t("why.titleFlagged") : t("why.title")}
        back={`/check/${id}`}
        right={<VerdictPill verdict={c.finalVerdict} size="medium" icon={false} label={verdictLabel} />}
      />
      {c.familyVerdict && (
        <div className={`card ${c.familyVerdict === "not_scam" ? "tint-green" : "tint-red"}`} style={{ padding: "10px 14px" }}>
          <b style={{ fontSize: 16 }}>{t("why.checkedIt", { name: c.familyVerdictByName ?? "", verdict: c.familyVerdict === "not_scam" ? t("common.notAScam") : t("common.aScam") })}</b>
          {c.familyVerdict === "not_scam" && <p className="sm" style={{ color: "var(--text)" }}>{t("why.belowFlagged")}</p>}
        </div>
      )}
      <div className="card" style={{ padding: "12px 14px" }}>
        <div className="lbl">{c.source === "call" ? t("verdict.whatYouTold") : t("home.yourMessage")}</div>
        {text ? (
          <HighlightedText text={text} signals={c.signals} numbers={numbers} link={c.link} onLink={() => router.push(`/check/${id}/link`)} />
        ) : (
          <>
            <p className="sm">{t("why.noKeep")}</p>
            <Marks phrases={keyPhrases(c.signals, c.link, c.hardPhrases, 5)} size={16} />
          </>
        )}
      </div>
      {order.map((s) => {
        const found = c.signals.filter((x) => x.type === s);
        const num = numbers.get(s);
        return (
          <div className="card" key={s} style={{ padding: "10px 14px" }}>
            <div className="row">
              <span className={`num ${num ? "" : "no"}`}>{num ?? "–"}</span>
              <div className="grow">
                <b style={{ fontSize: 16, color: num ? undefined : "var(--muted)" }}>{t(`signal.${s}`)}</b>
                <p className="sm" style={{ fontSize: 13 }}>
                  {num ? t(`signalWhy.${s}`) : noAi ? t("why.notFoundRules") : t("why.notInMessage")}
                </p>
              </div>
              {num && <span className={`tag ${found.some((f) => f.by === "ai") && !found.some((f) => f.by === "rules") ? "a" : ""}`}>
                {found.some((f) => f.by === "rules") ? t("why.rules") : t("why.aiRead")}
              </span>}
            </div>
          </div>
        );
      })}
      {c.hardPhrases.length > 0 && (
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="row">
            <span className="num" style={{ background: "#C6372B" }}>!</span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{t("why.asksCode")}</b>
              <p className="sm" style={{ fontSize: 13 }}>{t("why.nobodyAsks", { phrase: c.hardPhrases[0].phrase })}</p>
            </div>
            <span className="tag">{t("why.rules")}</span>
          </div>
        </div>
      )}
      {c.link && c.link.status !== "known" && (
        <button className="card" style={{ padding: "10px 14px" }} onClick={() => router.push(`/check/${id}/link`)}>
          <div className="row">
            <Icon name="link" />
            <div className="grow">
              <b style={{ fontSize: 16, wordBreak: "break-all" }}>{c.link.domain}</b>
              <p className="sm" style={{ fontSize: 13 }}>{c.link.reason}</p>
            </div>
            <Icon name="chev" />
          </div>
        </button>
      )}
      {c.hardRule && (
        <div className="card tint-amber" style={{ padding: "10px 14px" }}>
          <div className="lbl" style={{ color: "var(--text)" }}>{t("why.floor")}</div>
          <p className="sm" style={{ color: "var(--text)" }}>{t(FLOOR_KEY[c.hardRule])}</p>
        </div>
      )}
      {c.familyTitle && (
        <div className="card tint-red" style={{ padding: "10px 14px" }}>
          <div className="lbl" style={{ color: "var(--red-text)" }}>{t("why.looksLike")}</div>
          <b style={{ fontSize: 17 }}>{c.familyTitle}</b>
          <p className="sm" style={{ fontSize: 13, color: "var(--text)" }}>{c.familyStory}</p>
        </div>
      )}
      {c.decidedBy === "ai" && <p className="sm">{t("why.confirmedAi")}</p>}
      <div className="spacer" />
      {c.verdict === "SAFE" ? (
        <button className="btn green" onClick={() => router.push("/")}>{t("common.done")}</button>
      ) : (
        <button className="btn amber" onClick={() => router.push(`/check/${id}/todo`)}>{t("verdict.whatToDo")}</button>
      )}
    </Screen>
  );
}

/** F2 · What to do and what not to do */
export function TodoScreen() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const lang = useLang();
  const call = useRaoCall();
  const helper = useHelper();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen title={t("common.loading")} />;
  const who = helper.all.length ? helper.all.join(` ${t("common.or")} `) : t("common.yourFamily");
  return (
    <Screen>
      <TitleRow title={t("todo.title")} back={`/check/${id}`} right={<VerdictPill verdict={c.verdict} size="medium" icon={false} label={t(`verdictLabel.${c.verdict}`)} />} />
      <div className="card tint-green" style={{ gap: 9 }}>
        <div className="lbl" style={{ color: "var(--green-ink)" }}>{t("todo.do")}</div>
        {DO_LIST(who, lang).map((s) => (
          <div className="li" key={s}><span style={{ color: "var(--green-text)" }}><Icon name="check" /></span><span>{s}</span></div>
        ))}
      </div>
      <div className="card tint-red" style={{ gap: 9 }}>
        <div className="lbl" style={{ color: "var(--red-text)" }}>{t("todo.dont")}</div>
        {DONT_LIST(lang).map((s) => (
          <div className="li" key={s}><span style={{ color: "var(--red-text)" }}><Icon name="x" /></span><span>{s}</span></div>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn green" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
      <button className="btn line" onClick={() => call(t("common.helplineName"), HELPLINE)}>{t("common.helpline")}</button>
      <p className="sm center-text">{t("todo.report")}</p>
    </Screen>
  );
}

/** G3 · Link stopped */
export function LinkScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen title={t("common.loading")} />;
  const link = c.link;
  return (
    <Screen>
      <TitleRow title={t("link.title")} back={`/check/${id}`} />
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <span className="circle" style={{ width: 96, height: 96, background: "#C6372B", color: "#fff" }}><Icon name="link" size={48} /></span>
      </div>
      <h1 className="h1 center-text">{t("link.stopped")}</h1>
      <div className="card" style={{ gap: 8 }}>
        <div className="row">
          <b className="grow" style={{ fontSize: 18, wordBreak: "break-all" }}>{link?.domain ?? t("link.unknownLink")}</b>
          <span className="tag">{link?.status === "lookalike" ? t("verdict.fakeSite") : link?.status === "blocked" ? t("verdict.scamSite") : t("verdict.unknownSite")}</span>
        </div>
        <p className="sm">{c.verdict === "SCAM" ? t("link.cameInScam") : t("link.cameInSuspicious")}</p>
      </div>
      <div className="card tint-red">
        <b style={{ fontSize: 17 }}>{t("link.whyNotSafe")}</b>
        <p className="sm" style={{ color: "var(--text)" }}>{t("link.openingCan")} {link?.reason}</p>
      </div>
      <div className="spacer" />
      <button className="btn ink" onClick={() => router.push(`/check/${id}`)}>{t("link.goBack")}</button>
      <button className="btn line" onClick={() => router.push(`/check/${id}/todo`)}>{t("link.whatNow")}</button>
    </Screen>
  );
}

/** G2 · He opens the payment anyway: it is locked while family decides. F14a · the money screen says what happened when the app is unreachable. */
export function PayScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const join = useJoinNames();
  const call = useRaoCall();
  const toast = useToast();
  const helper = useHelper();
  const rao = useRao();
  const { data: c, error, refetch } = useCheck(id);
  const open = useMutation({ mutationFn: () => post<{ holdId: string; status: HoldStatus }>(`/api/me/checks/${id}/pay`) });
  const cancel = useMutation({
    mutationFn: (holdId: string) => post(`/api/me/holds/${holdId}/cancel`),
    onSuccess: async () => {
      toast({ title: t("pay.cancelled"), sub: t("pay.nothingPaid"), icon: "check" });
      await queryClient.invalidateQueries();
      router.push("/");
    },
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open.mutate(undefined, {
      onSuccess: async (r) => {
        // A hold that is already decided or out of time has its own screen (H3–H5).
        if (r.status !== "pending") router.replace(`/hold/${r.holdId}`);
        await queryClient.invalidateQueries({ queryKey: ["check", id] });
      },
    });
  }, [open, id, queryClient, router]);

  // Once the hold is decided, or runs out while he waits here, its own screen (H3–H5) takes over.
  const holdId = c?.hold?.id;
  const holdState = c?.hold?.status;
  useEffect(() => {
    if (holdId && holdState && holdState !== "pending" && holdState !== "cancelled") router.replace(`/hold/${holdId}`);
  }, [holdId, holdState, router]);

  const hold = c?.hold?.status === "pending" ? c.hold : null;
  const clock = useCountdown(hold?.expiresAt, rao.data?.serverNow, holdTotalMs(hold));

  // F14a: the app cannot be reached and we have nothing to show. The money stays held either way.
  const unreachable = (error instanceof ApiError && error.status === 0) || (open.isError && open.error instanceof ApiError && open.error.status === 0);
  if (!c && unreachable) {
    return (
      <Screen>
        <TitleRow title={t("pay.title")} back={`/check/${id}`} />
        <div className="note"><Icon name="wifi" />{t("common.reconnecting")}</div>
        <div className="card tint-red" style={{ gap: 6 }}>
          <div className="row"><Icon name="wifi" /><b style={{ fontSize: 19 }}>{t("pay.cannotReachApp")}</b></div>
          <p className="sm" style={{ color: "var(--text)" }}>{t("pay.internetDropped")}</p>
        </div>
        <div className="card row-card tint-amber">
          <Icon name="lock" />
          <div className="grow">
            <b style={{ fontSize: 17 }}>{t("pay.stillHeld")}</b>
            <p className="sm" style={{ color: "var(--text)" }}>{t("pay.neverReleased")}</p>
          </div>
        </div>
        <div className="spacer" />
        <button className="btn amber" onClick={() => { started.current = false; open.reset(); void refetch(); }}>{t("common.tryAgain")}</button>
        <button className="btn line" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
      </Screen>
    );
  }
  if (!c) return <LoadingScreen title={t("common.loading")} />;
  const who = helper.all.length ? join(helper.all) : t("common.yourFamily");

  return (
    <Screen>
      <TitleRow title={t("pay.title")} back={`/check/${id}`} />
      <div style={{ border: "2px solid #C6372B", borderRadius: 12, padding: "10px 12px", fontSize: 14, fontWeight: 800, letterSpacing: ".04em", color: "var(--red-text)", textAlign: "center" }}>
        {t("pay.demoBar")}
      </div>
      <div className="card solid-red" style={{ gap: 6 }}>
        <div className="row"><Icon name="warn" /><b style={{ fontSize: 19 }}>{c.verdict === "SCAM" ? t("pay.stopScam") : t("pay.stopSuspicious")}</b></div>
        <p className="sm" style={{ color: "#fff" }}>{t("pay.askedMoney")}</p>
      </div>
      <div className="card" style={{ gap: 12, padding: 16 }}>
        <div>
          <div className="lbl">{t("pay.payTo")}</div>
          <div style={{ fontWeight: 800, fontSize: 19 }}>{c.payee ?? t("pay.unknownAccount")}</div>
        </div>
        <div>
          <div className="lbl">{t("pay.amount")}</div>
          <div className="display" style={{ fontWeight: 800, fontSize: 44, lineHeight: 1.1 }}>{c.amount ? rupees(c.amount) : "—"}</div>
        </div>
      </div>
      <div className="card row-card tint-amber">
        <Icon name="lock" />
        <div className="grow">
          <b style={{ fontSize: 17 }}>{t("pay.locked")}</b>
          <p className="sm" style={{ color: "var(--text)" }}>
            {hold
              ? helper.all.length > 1 ? t("pay.lookingAtMany", { who, time: clock.label }) : t("pay.lookingAt", { who, time: clock.label })
              : open.isError ? open.error.message : t("pay.locking")}
          </p>
        </div>
      </div>
      {hold?.twoKeys && (
        <div className="card" style={{ border: "2px solid var(--text)", gap: 4 }}>
          <b style={{ fontSize: 16 }}>{t("hold.twoKeys")}</b>
          <p className="sm">{t("hold.twoKeysBody")}</p>
        </div>
      )}
      <div className="spacer" />
      <button className="btn green" style={{ minHeight: 68, fontSize: 22 }} disabled={!hold || cancel.isPending} onClick={() => hold && cancel.mutate(hold.id)}>
        {t("pay.cancel")}
      </button>
      <button className="btn off md-btn" disabled><Icon name="lock" />{t("pay.payLocked")}</button>
      <button className="ghost" style={{ alignSelf: "center" }} onClick={() => call(helper.first, helper.phone)}>{t("common.callName", { name: helper.first })}</button>
    </Screen>
  );
}
