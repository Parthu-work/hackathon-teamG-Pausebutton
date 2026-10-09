"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Screen, TitleRow, useClientValue, useToast } from "@/components/ui";
import { bcp47 } from "@/lib/i18n";
import { ApiError, post } from "@/lib/client/api";
import { saveMessage } from "@/lib/client/messages";
import { canListen, listen, type Listener } from "@/lib/client/speech";
import { useLang, useT } from "./shell";

/** F10b · He speaks instead of typing. */
export function SpeakScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  const lang = useLang();
  const supported = useClientValue<boolean | null>(canListen, null);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<Listener | null>(null);

  // Leaving the screen stops the microphone.
  useEffect(() => () => active.current?.stop(), []);

  function start() {
    setProblem(null);
    const l = listen(bcp47(lang), {
      onText: (text) => setHeard(text),
      onEnd: () => setListening(false),
      onError: (kind) => {
        setListening(false);
        setProblem(kind === "denied" ? t("speak.micDenied") : kind === "nothing" ? t("speak.heardNothing") : t("speak.notSupported"));
      },
    });
    if (!l) {
      setProblem(t("speak.notSupported"));
      return;
    }
    active.current = l;
    setListening(true);
  }

  function stop() {
    active.current?.stop();
    active.current = null;
    setListening(false);
  }

  async function check() {
    stop();
    setBusy(true);
    try {
      const r = await post<{ checkId: string; verdict: string }>("/api/me/checks", { text: heard, source: "voice" });
      saveMessage(r.checkId, heard.trim());
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      router.push(r.verdict === "SCAM" ? `/check/${r.checkId}/stop` : `/check/${r.checkId}`);
    } catch (e) {
      setBusy(false);
      toast({ title: t("home.couldNotCheck"), sub: e instanceof ApiError ? e.message : String(e), icon: "warn", tone: "red" });
    }
  }

  return (
    <Screen>
      <TitleRow title={t("speak.title")} back="/" />
      <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
        <button
          aria-label={listening ? t("speak.stop") : t("speak.start")}
          className="circle"
          onClick={listening ? stop : start}
          disabled={supported === false}
          style={{ width: 132, height: 132, background: listening ? "#C6372B" : "var(--ink)", color: "#fff", boxShadow: listening ? "0 0 0 16px rgba(198,55,43,.18)" : "0 0 0 14px rgba(242,169,0,.14)", transition: "box-shadow .3s" }}
        >
          <Icon name="mic" size={60} />
        </button>
      </div>
      <h2 className="h2 center-text">{listening ? t("speak.listening") : supported === false ? t("speak.notSupported") : problem ?? t("speak.tapToStart")}</h2>
      <div className="card" style={{ gap: 6, minHeight: 120 }}>
        <div className="lbl">{t("speak.whatHeard")}</div>
        <p className="p" style={{ fontSize: 18, lineHeight: 1.4, color: heard ? "var(--text)" : "var(--muted)" }}>{heard ? `“${heard}”` : "…"}</p>
      </div>
      <div className="card tint-green">
        <b style={{ fontSize: 17 }}>{t("speak.noTyping")}</b>
        <p className="sm" style={{ color: "var(--text)" }}>{t("speak.noTypingBody")}</p>
      </div>
      <div className="spacer" />
      <button className="btn amber big" disabled={!heard.trim() || busy} onClick={check}>{t("speak.checkSaid")}</button>
      <button className="btn line" onClick={() => router.push("/")}>{t("speak.typeInstead")}</button>
    </Screen>
  );
}
