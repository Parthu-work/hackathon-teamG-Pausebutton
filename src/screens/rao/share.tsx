"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Screen } from "@/components/ui";
import { ApiError, post } from "@/lib/client/api";
import { saveMessage } from "@/lib/client/messages";
import { clearPendingShare, stashPendingShare } from "@/lib/client/pending-share";
import { useT } from "./shell";

// F1 · Forward to Pause: no copy, no paste. The phone's Share sheet (the
// Android app, or the installed web app) lands here with the text; it is
// checked at once and the verdict opens. `from` names the app it came from.
// A signed-out phone keeps the text through sign-in (see pending-share.ts).

const APPS: Record<string, string> = { whatsapp: "WhatsApp", sms: "Messages", messages: "Messages", telegram: "Telegram", other: "another app" };

export function appLabel(from: string | null | undefined) {
  if (!from) return "another app";
  return APPS[from.toLowerCase()] ?? from;
}

export function ShareScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const t = useT();
  const text = [search.get("text"), search.get("title"), search.get("url")].filter((s) => s && s.trim()).join("\n").trim();
  const fromKey = search.get("from");
  const from = appLabel(fromKey);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !text) return;
    started.current = true;
    // Keep it in case the person has to sign in first; the home screen resumes it.
    stashPendingShare({ text, from: fromKey });
    (async () => {
      try {
        const r = await post<{ checkId: string; verdict: string }>("/api/me/checks", { text, source: "share", senderLabel: from });
        clearPendingShare();
        saveMessage(r.checkId, text);
        await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
        router.replace(r.verdict === "SCAM" ? `/check/${r.checkId}/stop` : `/check/${r.checkId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/welcome");
          return;
        }
        setError(e instanceof ApiError ? e.message : String(e));
      }
    })();
  }, [text, from, fromKey, router, queryClient]);

  if (!text) {
    return (
      <Screen>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <span className="circle" style={{ width: 96, height: 96, background: "var(--chip)" }}><Icon name="share" size={44} /></span>
        </div>
        <h1 className="h1 center-text">{t("share.nothing")}</h1>
        <p className="p center-text">{t("share.nothingBody")}</p>
        <div className="spacer" />
        <button className="btn ink" onClick={() => router.replace("/")}>{t("share.goHome")}</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="row">
        <span className="pm"><i /><i /></span>
        <b className="grow display" style={{ fontSize: 20 }}>{t("common.appName")}</b>
        <span className="tag a">{t("verdict.forwardedFrom", { app: from.toUpperCase() })}</span>
      </div>
      <h1 className="h1" style={{ marginTop: 6 }}>{error ? t("home.couldNotCheck") : t("share.checking")}</h1>
      <div className="card" style={{ gap: 4 }}>
        <div className="lbl">{t("home.yourMessage")}</div>
        <p className="p" style={{ fontSize: 16, color: "var(--muted)" }}>{text.length > 160 ? text.slice(0, 160) + "…" : text}</p>
      </div>
      {error ? (
        <>
          <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>
          <div className="spacer" />
          <button className="btn amber" onClick={() => { started.current = false; setError(null); router.refresh(); }}>{t("common.tryAgain")}</button>
          <button className="btn line" onClick={() => router.replace("/")}>{t("share.goHome")}</button>
        </>
      ) : (
        <div className="card" style={{ gap: 14 }}>
          {[0, 1, 2].map((i) => (
            <div className="row" key={i}><span className="sk" /><span className="tag">{t("home.checking")}</span></div>
          ))}
        </div>
      )}
    </Screen>
  );
}
