"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { NativeNotificationsBanner } from "@/components/native-notifications";
import { RaoTabs, Screen, useCall, useClientValue, useToast } from "@/components/ui";
import examples from "@/data/examples.json";
import { SIGNAL_TYPES } from "@/lib/check/types";
import { ApiError, post } from "@/lib/client/api";
import { saveMessage } from "@/lib/client/messages";
import { takePendingShare } from "@/lib/client/pending-share";
import { canListen } from "@/lib/client/speech";
import { displayName } from "@/lib/display-name";
import { useHelper, useRao, useT } from "./shell";

const MAX = 4000;
const TITLES: Record<string, string> = {
  cbi: "CBI parcel message",
  kyc: "Bank KYC link",
  courier: "Courier fee message",
  lottery: "Lottery win message",
  bank: "Bank debit alert",
  hindi: "Lottery win message",
};

/** "Good morning, Ramesh", or the plain greeting when there is no name to use (old "Guest" accounts). */
function greetingKey(h: number, named: boolean) {
  if (h < 12) return named ? "home.morningName" : "home.morning";
  if (h < 17) return named ? "home.afternoonName" : "home.afternoon";
  return named ? "home.eveningName" : "home.evening";
}

const currentHour = () => new Date().getHours();

/** D1 · Home · F6a · the second door (someone is calling me) · D2 · Message ready · D3 · Checking · Q3 · Service unreachable */
export function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const call = useCall({ noNumber: t("common.noNumber"), addNumber: t("common.addNumber"), callShows: t("common.callShows"), onPhoneDialer: t("common.onPhoneDialer") });
  const toast = useToast();
  const { data } = useRao();
  const helper = useHelper();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "checking" | "error">("edit");
  const [progress, setProgress] = useState(0);
  // The greeting and the microphone depend on the phone, so they render after
  // hydration (until then: the afternoon greeting).
  const hour = useClientValue(currentHour, null);
  const name = displayName(data?.me.name);
  const mic = useClientValue(canListen, false);

  // F1 · A message forwarded before sign-in: now that he is signed in, check it.
  useEffect(() => {
    if (!data) return;
    const pending = takePendingShare();
    if (!pending) return;
    const params = new URLSearchParams({ text: pending.text });
    if (pending.from) params.set("from", pending.from);
    router.replace(`/share?${params.toString()}`);
  }, [data, router]);

  useEffect(() => {
    if (phase !== "checking") return;
    const t = setInterval(() => setProgress((p) => Math.min(92, p + 9)), 180);
    return () => clearInterval(t);
  }, [phase]);

  const linkedPeople = (data?.people ?? []).filter((p) => p.status === "linked");
  const linked = linkedPeople.length > 0;
  const tabs = <RaoTabs active="check" labels={{ check: t("common.tabCheck"), checks: t("common.tabChecks"), settings: t("common.tabSettings") }} />;

  async function check() {
    setProgress(8);
    setPhase("checking");
    const started = Date.now();
    try {
      const title = picked && examples.find((e) => e.id === picked)?.text === text ? TITLES[picked] : undefined;
      const r = await post<{ checkId: string; verdict: string }>("/api/me/checks", { text, title });
      saveMessage(r.checkId, text.trim());
      // Let the "reading" moment land (~1.5 s) even when the check is instant.
      await new Promise((res) => setTimeout(res, Math.max(0, 1500 - (Date.now() - started))));
      setProgress(100);
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      router.push(r.verdict === "SCAM" ? `/check/${r.checkId}/stop` : `/check/${r.checkId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) {
        setPhase("edit");
        toast({ title: t("home.couldNotCheck"), sub: e.message, icon: "warn", tone: "red" });
      } else setPhase("error");
    }
  }

  if (phase === "error") {
    return (
      <Screen>
        <div className="note"><Icon name="wifi" />{t("common.reconnecting")}</div>
        <div style={{ display: "flex", justifyContent: "center", margin: "18px 0 6px" }}>
          <span className="circle" style={{ width: 120, height: 120, background: "var(--red-tint)", color: "var(--red-text)", boxShadow: "0 0 0 14px rgba(242,169,0,.10)" }}>
            <Icon name="wifi" size={48} />
          </span>
        </div>
        <h1 className="h1 center-text">{t("home.cannotReach")}</h1>
        <p className="p center-text" style={{ color: "var(--muted)" }}>{t("home.nothingSent", { name: helper.first })}</p>
        <div className="spacer" />
        <button className="btn amber" onClick={check}>{t("common.tryAgain")}</button>
        <button className="btn line" onClick={() => call(helper.first, helper.phone)}><Icon name="phone" />{t("common.callName", { name: helper.first })}</button>
      </Screen>
    );
  }

  if (phase === "checking") {
    return (
      <Screen tabs={tabs}>
        <div className="row">
          <span className="pm"><i /><i /></span>
          <b className="grow display" style={{ fontSize: 20 }}>{t("common.appName")}</b>
        </div>
        <h1 className="h1" style={{ marginTop: 6 }}>{t("home.reading")}</h1>
        <div className="card" style={{ gap: 4 }}>
          <div className="lbl">{t("home.yourMessage")}</div>
          <p className="p" style={{ fontSize: 16, color: "var(--muted)" }}>{text.length > 110 ? text.slice(0, 110) + "…" : text}</p>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--track2)", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "#F2A900", transition: "width .2s" }} />
        </div>
        <div className="card" style={{ gap: 14 }}>
          {SIGNAL_TYPES.map((s) => (
            <div className="row" key={s}>
              <span className="lbl" style={{ width: 92 }}>{t(`signal.${s}`)}</span>
              <span className="sk" />
              <span className="tag">{t("home.checking")}</span>
            </div>
          ))}
        </div>
        <p className="sm">{t("home.aiSlow")}</p>
        <div className="spacer" />
        <button className="btn off big" disabled>{t("home.wait")}</button>
      </Screen>
    );
  }

  const ready = text.trim().length > 0;
  return (
    <Screen tabs={tabs}>
      <div className="row">
        <span className="pm"><i /><i /></span>
        <b className="grow display" style={{ fontSize: 20 }}>{t("common.appName")}</b>
        {linked ? (
          <span className="tag" style={{ background: "var(--green-tint)", color: "var(--green-ink)" }}>
            {t("home.helperTag", { name: helper.first.toUpperCase() })}
          </span>
        ) : (
          <Link className="tag a" href="/setup" style={{ textDecoration: "none" }}>{t("home.addHelper")}</Link>
        )}
      </div>
      <NativeNotificationsBanner />
      {!ready && (
        <>
          <h1 className="h1" style={{ marginTop: 6 }}>{t(greetingKey(hour ?? 12, !!name), { name: name ?? "" })}</h1>
          <p className="p">{t("home.startHere")}</p>
        </>
      )}

      {/* Door 1 · check a message (paste, forward or speak) */}
      <div className="card" style={{ gap: 10, borderWidth: 2, borderColor: ready ? "var(--text)" : "var(--border)" }}>
        <div className="row">
          <span className="circle" style={{ width: 44, height: 44, background: "#F2A900", color: "#14202B" }}><Icon name="msg" /></span>
          <div className="grow">
            <b style={{ fontSize: 18 }}>{t("home.doorCheck")}</b>
            <p className="sm">{t("home.doorCheckSub")}</p>
          </div>
        </div>
        <textarea
          className="ta"
          aria-label="Message to check"
          placeholder={t("home.placeholder")}
          value={text}
          maxLength={MAX}
          style={{ minHeight: ready ? 170 : 110, boxShadow: "none" }}
          onChange={(e) => {
            setText(e.target.value);
            setPicked(null);
          }}
        />
        {ready ? (
          <div className="row">
            <span className="sm grow">{t("home.chars", { n: text.length.toLocaleString("en-IN") })}</span>
            <button className="ghost" onClick={() => { setText(""); setPicked(null); }}>{t("home.clear")}</button>
          </div>
        ) : (
          <div className="lbl">{t("home.orExample")}</div>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          {examples.map((e) => (
            <button
              key={e.id}
              className={`chip ${picked === e.id ? "on" : ""}`}
              onClick={() => {
                setText(e.text);
                setPicked(e.id);
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          {mic && (
            <Link href="/speak" className="ghost" style={{ fontSize: 15 }}>
              <Icon name="mic" size={18} />{t("home.speak")}
            </Link>
          )}
          <Link href="/inbox" className="ghost" style={{ fontSize: 15 }}>
            <Icon name="inbox" size={18} />{t("home.openInbox")}
          </Link>
        </div>
      </div>

      {/* Door 2 · someone is calling me (F6) */}
      {!ready && (
        <>
          <button className="card row-card" style={{ border: "2px solid var(--text)", padding: 16 }} onClick={() => router.push("/call")} data-testid="door-call">
            <span className="circle" style={{ width: 44, height: 44, background: "var(--ink)", color: "#fff" }}><Icon name="phone" /></span>
            <div className="grow">
              <b style={{ fontSize: 18 }}>{t("home.doorCall")}</b>
              <p className="sm">{t("home.doorCallSub")}</p>
            </div>
            <Icon name="chev" />
          </button>
          <div className="card tint-amber" style={{ gap: 4 }}>
            <b style={{ fontSize: 16 }}>{t("home.newCall")}</b>
            <p className="sm" style={{ color: "var(--text)" }}>{t("home.newCallSub")}</p>
          </div>
          {linked && (
            <div className="row wrap" style={{ gap: 8 }}>
              {linkedPeople.map((p) => (
                <span key={p.id} className="tag g">{t("home.linked", { name: p.name.toUpperCase() })}</span>
              ))}
            </div>
          )}
        </>
      )}
      <div className="spacer" />
      <button className={`btn big ${ready ? "amber" : "off"}`} disabled={!ready} onClick={check} data-testid="check-button">
        <span className="pm dark" style={{ opacity: ready ? 1 : 0.5 }}><i /><i /></span>
        {t("home.checkButton")}
      </button>
      <p className="sm center-text">{ready ? t("home.takes") : t("home.pasteFirst")}</p>
    </Screen>
  );
}
