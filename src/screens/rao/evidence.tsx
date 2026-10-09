"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { HighlightedText, LoadingScreen, Marks, Screen, TitleRow, useCall, useCountdown, useToast, VerdictPill } from "@/components/ui";
import { DO_LIST, DONT_LIST, rupees, SIGNAL_LABEL, SIGNAL_WHY } from "@/lib/check/copy";
import { keyPhrases } from "@/lib/check/phrases";
import type { HardRule, SignalType } from "@/lib/check/types";
import { post } from "@/lib/client/api";
import { loadMessage } from "@/lib/client/messages";
import { HELPLINE } from "@/lib/phone";
import type { HoldStatus } from "@/lib/views";
import { useHelper } from "./shell";
import { useCheck } from "./verdict";

const FLOOR: Record<HardRule, string> = {
  secrecy_payment: "Secrecy and payment together is always a SCAM, whatever the AI says.",
  credential_request: "Asking for an OTP, PIN or screen-sharing app is always a SCAM.",
  bad_link: "A link that copies a bank or brand, or a known scam site, is always a SCAM.",
};

/** F1 · Why it is a scam · F3 · rules only */
export function WhyScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen />;

  const text = c.simText ?? c.messageText ?? loadMessage(id);
  const order: SignalType[] = [];
  [...c.signals].sort((a, b) => a.start - b.start).forEach((s) => !order.includes(s.type) && order.push(s.type));
  (["authority", "fear", "secrecy", "payment"] as SignalType[]).forEach((t) => !order.includes(t) && order.push(t));
  const numbers = new Map<SignalType, number>();
  let n = 0;
  order.forEach((t) => c.signals.some((s) => s.type === t) && numbers.set(t, ++n));
  const noAi = c.degraded;

  return (
    <Screen note={noAi ? <div className="note" style={{ margin: "12px 20px 0" }}><Icon name="info" />Checked by rules only — AI unavailable</div> : undefined}>
      <TitleRow
        title={c.familyVerdict === "not_scam" ? "Why we flagged it" : "Why we think so"}
        back={`/check/${id}`}
        right={<VerdictPill verdict={c.finalVerdict} size="medium" icon={false} />}
      />
      {c.familyVerdict && (
        <div className={`card ${c.familyVerdict === "not_scam" ? "tint-green" : "tint-red"}`} style={{ padding: "10px 14px" }}>
          <b style={{ fontSize: 16 }}>
            {c.familyVerdictByName} checked it: {c.familyVerdict === "not_scam" ? "not a scam" : "a scam"}.
          </b>
          {c.familyVerdict === "not_scam" && <p className="sm" style={{ color: "var(--text)" }}>Below is what Pause Button had flagged before they looked at it.</p>}
        </div>
      )}
      <div className="card" style={{ padding: "12px 14px" }}>
        <div className="lbl">Your message</div>
        {text ? (
          <HighlightedText text={text} signals={c.signals} numbers={numbers} link={c.link} onLink={() => router.push(`/check/${id}/link`)} />
        ) : (
          <>
            <p className="sm">We do not keep your messages. These are the warning phrases we found:</p>
            <Marks phrases={keyPhrases(c.signals, c.link, c.hardPhrases, 5)} size={16} />
          </>
        )}
      </div>
      {order.map((t) => {
        const found = c.signals.filter((s) => s.type === t);
        const num = numbers.get(t);
        return (
          <div className="card" key={t} style={{ padding: "10px 14px" }}>
            <div className="row">
              <span className={`num ${num ? "" : "no"}`}>{num ?? "–"}</span>
              <div className="grow">
                <b style={{ fontSize: 16, color: num ? undefined : "var(--muted)" }}>{SIGNAL_LABEL[t]}</b>
                <p className="sm" style={{ fontSize: 13 }}>
                  {num ? SIGNAL_WHY[t] : noAi ? "Not found by rules. The AI would normally check this." : "Not found in this message."}
                </p>
              </div>
              {num && <span className={`tag ${found.some((f) => f.by === "ai") && !found.some((f) => f.by === "rules") ? "a" : ""}`}>
                {found.some((f) => f.by === "rules") ? "RULES" : "AI READ"}
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
              <b style={{ fontSize: 16 }}>Asks for a code or app</b>
              <p className="sm" style={{ fontSize: 13 }}>“{c.hardPhrases[0].phrase}”. Nobody genuine asks for this.</p>
            </div>
            <span className="tag">RULES</span>
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
          <div className="lbl" style={{ color: "var(--text)" }}>The floor</div>
          <p className="sm" style={{ color: "var(--text)" }}>{FLOOR[c.hardRule]}</p>
        </div>
      )}
      {c.familyTitle && (
        <div className="card tint-red" style={{ padding: "10px 14px" }}>
          <div className="lbl" style={{ color: "var(--red-text)" }}>This looks like</div>
          <b style={{ fontSize: 17 }}>{c.familyTitle}</b>
          <p className="sm" style={{ fontSize: 13, color: "var(--text)" }}>{c.familyStory}</p>
        </div>
      )}
      {c.decidedBy === "ai" && <p className="sm">Confirmed by AI.</p>}
      <div className="spacer" />
      {c.verdict === "SAFE" ? (
        <button className="btn green" onClick={() => router.push("/")}>Done</button>
      ) : (
        <button className="btn amber" onClick={() => router.push(`/check/${id}/todo`)}>What to do now</button>
      )}
    </Screen>
  );
}

/** F2 · What to do and what not to do */
export function TodoScreen() {
  const { id } = useParams<{ id: string }>();
  const call = useCall();
  const helper = useHelper();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen />;
  const who = helper.all.length ? helper.all.join(" or ") : "your family";
  return (
    <Screen>
      <TitleRow title="What to do now" back={`/check/${id}`} right={<VerdictPill verdict={c.verdict} size="medium" icon={false} />} />
      <div className="card tint-green" style={{ gap: 9 }}>
        <div className="lbl" style={{ color: "var(--green-ink)" }}>Do</div>
        {DO_LIST(who).map((t) => (
          <div className="li" key={t}><span style={{ color: "var(--green-text)" }}><Icon name="check" /></span><span>{t}</span></div>
        ))}
      </div>
      <div className="card tint-red" style={{ gap: 9 }}>
        <div className="lbl" style={{ color: "var(--red-text)" }}>Do not</div>
        {DONT_LIST.map((t) => (
          <div className="li" key={t}><span style={{ color: "var(--red-text)" }}><Icon name="x" /></span><span>{t}</span></div>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn green" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />Call {helper.first}</button>
      <button className="btn line" onClick={() => call("cyber helpline 1930", HELPLINE)}>Call cyber helpline 1930</button>
      <p className="sm center-text">You can also report it at cybercrime.gov.in or on Sanchar Saathi (Chakshu).</p>
    </Screen>
  );
}

/** G3 · Link stopped */
export function LinkScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: c } = useCheck(id);
  if (!c) return <LoadingScreen />;
  const link = c.link;
  return (
    <Screen>
      <TitleRow title="Link stopped" back={`/check/${id}`} />
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <span className="circle" style={{ width: 96, height: 96, background: "#C6372B", color: "#fff" }}><Icon name="link" size={48} /></span>
      </div>
      <h1 className="h1 center-text">We stopped this link</h1>
      <div className="card" style={{ gap: 8 }}>
        <div className="row">
          <b className="grow" style={{ fontSize: 18, wordBreak: "break-all" }}>{link?.domain ?? "Unknown link"}</b>
          <span className="tag">{link?.status === "lookalike" ? "FAKE SITE" : link?.status === "blocked" ? "SCAM SITE" : "UNKNOWN SITE"}</span>
        </div>
        <p className="sm">It came in a {c.verdict === "SCAM" ? "scam" : "suspicious"} message.</p>
      </div>
      <div className="card tint-red">
        <b style={{ fontSize: 17 }}>Why it is not safe</b>
        <p className="sm" style={{ color: "var(--text)" }}>
          Opening it can steal your money, your passwords or take over your phone. {link?.reason}
        </p>
      </div>
      <div className="spacer" />
      <button className="btn ink" onClick={() => router.push(`/check/${id}`)}>Go back to safety</button>
      <button className="btn line" onClick={() => router.push(`/check/${id}/todo`)}>What should I do now?</button>
    </Screen>
  );
}

/** G2 · He opens the payment anyway: it is locked while family decides */
export function PayScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const call = useCall();
  const toast = useToast();
  const helper = useHelper();
  const { data: c } = useCheck(id);
  const open = useMutation({ mutationFn: () => post<{ holdId: string; status: HoldStatus }>(`/api/me/checks/${id}/pay`) });
  const cancel = useMutation({
    mutationFn: (holdId: string) => post(`/api/me/holds/${holdId}/cancel`),
    onSuccess: async () => {
      toast({ title: "Payment cancelled", sub: "Nothing was paid", icon: "check" });
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
  const clock = useCountdown(hold?.expiresAt);
  if (!c) return <LoadingScreen />;
  const who = helper.all.length ? helper.all.join(" and ") : "Your family";

  return (
    <Screen>
      <TitleRow title="Payment (demo)" back={`/check/${id}`} />
      <div style={{ border: "2px solid #C6372B", borderRadius: 12, padding: "10px 12px", fontSize: 14, fontWeight: 800, letterSpacing: ".04em", color: "var(--red-text)", textAlign: "center" }}>
        DEMO PAYMENT · NOT A BANK · NO MONEY MOVES
      </div>
      <div className="card solid-red" style={{ gap: 6 }}>
        <div className="row"><Icon name="warn" /><b style={{ fontSize: 19 }}>STOP. This payment is for a {c.verdict === "SCAM" ? "scam" : "suspicious message"}.</b></div>
        <p className="sm" style={{ color: "#fff" }}>The message you checked asked for this money. Do not pay.</p>
      </div>
      <div className="card" style={{ gap: 12, padding: 16 }}>
        <div>
          <div className="lbl">Pay to</div>
          <div style={{ fontWeight: 800, fontSize: 19 }}>{c.payee ?? "Unknown account"}</div>
        </div>
        <div>
          <div className="lbl">Amount</div>
          <div className="display" style={{ fontWeight: 800, fontSize: 44, lineHeight: 1.1 }}>{c.amount ? rupees(c.amount) : "—"}</div>
        </div>
      </div>
      <div className="card row-card tint-amber">
        <Icon name="lock" />
        <div className="grow">
          <b style={{ fontSize: 17 }}>Locked while family decides</b>
          <p className="sm" style={{ color: "var(--text)" }}>
            {hold ? `${who} ${helper.all.length > 1 ? "are" : "is"} looking at this. ${clock.label} left.` : open.isError ? open.error.message : "Locking the payment…"}
          </p>
        </div>
      </div>
      <div className="spacer" />
      <button className="btn green" style={{ minHeight: 68, fontSize: 22 }} disabled={!hold || cancel.isPending} onClick={() => hold && cancel.mutate(hold.id)}>
        Cancel this payment
      </button>
      <button className="btn off md-btn" disabled><Icon name="lock" />Pay is locked</button>
      <button className="ghost" style={{ alignSelf: "center" }} onClick={() => call(helper.first, helper.phone)}>Call {helper.first}</button>
    </Screen>
  );
}
