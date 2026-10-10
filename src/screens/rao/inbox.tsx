"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, Screen, Sheet, TitleRow, useToast, VerdictPill } from "@/components/ui";
import { api, post } from "@/lib/client/api";
import type { SimMessageView, SimStatus } from "@/lib/views";
import { useT } from "./shell";

/** P1 · Simulated inbox (demo mode, any phone) · F1a · Share a message to Pause Button */
export function InboxScreen() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const queryClient = useQueryClient();
  const [sharing, setSharing] = useState<SimMessageView | null>(null);
  const q = useQuery({ queryKey: ["inbox"], queryFn: () => api<SimMessageView[]>("/api/me/inbox"), refetchInterval: 2000 });
  const receive = useMutation({
    mutationFn: () => post("/api/me/inbox"),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => toast({ title: t("inbox.couldNotDeliver"), sub: e.message, icon: "warn", tone: "red" }),
  });
  // "We could not check this message": the same check again, once per tap.
  const retry = useMutation({
    mutationFn: (id: string) => post<{ id: string; checkId: string | null; status: SimStatus }>(`/api/me/inbox/${id}/retry`),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      if (r.checkId) router.push(`/check/${r.checkId}`);
      else if (r.status === "failed") toast({ title: t("inbox.retryFailed"), icon: "warn", tone: "red" });
    },
    onError: () => toast({ title: t("inbox.retryFailed"), icon: "warn", tone: "red" }),
  });

  function open(m: SimMessageView) {
    if (m.checkId) router.push(`/check/${m.checkId}`);
    else if (m.status === "failed") {
      if (m.canRetry) retry.mutate(m.id);
      else toast({ title: t("inbox.couldNotCheck"), sub: t("inbox.textNotKept"), icon: "info" });
    } else if (m.status === "received") toast({ title: t("inbox.checking"), icon: "info" });
    else toast({ title: m.fromContact ? t("inbox.notChecked") : t("inbox.notWatched"), sub: m.fromContact ? t("inbox.contactsNotChecked") : t("inbox.watchingOff"), icon: "info" });
  }

  /** The small label on the right: the verdict, or why there is none. */
  function statusTag(m: SimMessageView) {
    if (m.verdict && m.verdict !== "SKIPPED") return <VerdictPill verdict={m.verdict} size="small" icon={false} label={t(`verdictLabel.${m.verdict}`)} />;
    if (m.status === "failed") return <span className="tag a">{t("inbox.statusFailed")}</span>;
    if (m.status === "received") return <span className="tag">{t("inbox.statusChecking")}</span>;
    if (m.status === "skipped") return <span className="tag">{m.verdict ?? t("inbox.statusNotWatched")}</span>;
    return null;
  }

  /** F1a · the phone's Share sheet: Pause Button is one of the targets. */
  function sendToPause(m: SimMessageView) {
    setSharing(null);
    if (!m.text) return;
    const params = new URLSearchParams({ text: m.text, from: m.channel === "whatsapp" ? "whatsapp" : "sms" });
    router.push(`/share?${params.toString()}`);
  }

  return (
    <Screen
      sim
      overlay={
        sharing && (
          <Sheet onClose={() => setSharing(null)}>
            <div className="card" style={{ background: "var(--bg)", gap: 4 }}>
              <div className="row">
                <span className="circle" style={{ width: 36, height: 36, background: "var(--chip)", fontWeight: 800 }}>?</span>
                <div className="grow">
                  <b style={{ fontSize: 15 }}>{sharing.sender}</b>
                  {!sharing.fromContact && <p className="sm">{t("share.notInContacts")}</p>}
                </div>
              </div>
              <p className="sm" style={{ color: "var(--text)" }}>{sharing.text}</p>
            </div>
            <div className="lbl">{t("share.shareWith")}</div>
            <div className="row" style={{ gap: 14, justifyContent: "space-around" }}>
              {[
                ["pause", t("common.appName"), "shield"],
                ["messages", t("share.messages"), "msg"],
                ["contacts", t("share.contacts"), "people"],
                ["copy", t("share.copy"), "edit"],
              ].map(([key, label, icon]) => (
                <button
                  key={key}
                  className="col"
                  style={{ alignItems: "center", gap: 6, background: "transparent", padding: 0, color: "inherit", minWidth: 64 }}
                  onClick={() => (key === "pause" ? sendToPause(sharing) : setSharing(null))}
                >
                  <span className="circle" style={{ width: 56, height: 56, background: key === "pause" ? "#F2A900" : "var(--chip)", color: "#14202B" }}>
                    <Icon name={icon as "shield" | "msg" | "people" | "edit"} size={26} />
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center" }}>{label}</span>
                </button>
              ))}
            </div>
            <button className="btn amber" onClick={() => sendToPause(sharing)} data-testid="send-to-pause">{t("share.sendTo")}</button>
          </Sheet>
        )
      }
    >
      <TitleRow title={t("inbox.title")} back="/" />
      <p className="sm">{t("share.forwardHint")}</p>
      {(q.data ?? []).map((m) => (
        <div key={m.id} className="card" style={{ gap: 6 }}>
          <button className="row" style={{ background: "transparent", padding: 0, textAlign: "left", color: "inherit", width: "100%" }} onClick={() => open(m)}>
            <span className="src"><Icon name="msg" /></span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{m.sender}</b>
              {m.canRetry ? (
                <>
                  <p className="sm" style={{ color: "var(--text)" }}>{t("inbox.couldNotCheck")}</p>
                  <p className="sm" style={{ fontWeight: 800 }}>{retry.isPending && retry.variables === m.id ? t("inbox.retrying") : t("inbox.tapToRetry")}</p>
                </>
              ) : (
                <p className="sm" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.status === "received" ? t("inbox.checking") : (m.text ?? t("inbox.textNotKept"))}
                </p>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span className="sm">{clockTime(m.createdAt)}</span>
              {statusTag(m)}
            </div>
          </button>
          {m.text && (
            <button className="ghost" style={{ alignSelf: "flex-end", fontSize: 14, minHeight: 36 }} onClick={() => setSharing(m)} aria-label={`${t("inbox.share")} ${m.sender}`}>
              <Icon name="share" size={18} />{t("inbox.share")}
            </button>
          )}
        </div>
      ))}
      <p className="sm">{t("inbox.contactsNotChecked")}</p>
      <div className="spacer" />
      <button className="btn amber" disabled={receive.isPending} onClick={() => receive.mutate()}>
        {receive.isPending ? t("inbox.delivering") : t("inbox.receive")}
      </button>
      <p className="sm center-text">{t("inbox.demoOnly")}</p>
    </Screen>
  );
}
