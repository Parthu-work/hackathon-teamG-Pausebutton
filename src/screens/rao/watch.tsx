"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, LoadingScreen, Screen, Sheet, TitleRow, Toggle, useToast } from "@/components/ui";
import { api, post } from "@/lib/client/api";
import type { DeviceView } from "@/lib/views";
import { useHelper, useRao } from "./shell";

// M1–M4: the real message watcher. The Android app reads incoming SMS and
// WhatsApp notifications and sends them here, where they go through the same
// check as a pasted message (and show up in My checks and the inbox).

/** M1 · consent, plus M4 · what to watch. */
export function WatchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const helper = useHelper();
  const { data } = useRao();
  const save = useMutation({
    mutationFn: (body: Record<string, boolean>) => api("/api/me/settings", { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rao-state"] }),
  });
  if (!data) return <LoadingScreen />;
  const me = data.me;
  const rows: [string, string, "watchSms" | "watchWhatsapp" | "unknownOnly" | "autoTellFamily"][] = [
    ["SMS messages", "", "watchSms"],
    ["WhatsApp messages", "", "watchWhatsapp"],
    ["Only unknown senders", "Skip messages from your saved contacts.", "unknownOnly"],
    [`Tell ${helper.first} automatically when I get a scam`, `${helper.first} gets a quiet heads-up. They never see your other messages.`, "autoTellFamily"],
  ];
  async function turnOn() {
    if (!me.watchSms && !me.watchWhatsapp) await api("/api/me/settings", { method: "PATCH", body: { watchSms: true, watchWhatsapp: true } });
    await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
    router.push("/watch/connect");
  }
  return (
    <Screen>
      <TitleRow title="Watch my messages" back="/settings" />
      <h1 className="h1">Let Pause Button watch your messages?</h1>
      <p className="p">When a message looks like a scam, we warn you before you reply.</p>
      <div className="card">
        <div className="lbl">What we read</div>
        <p className="p" style={{ fontSize: 16 }}>The text of new SMS and WhatsApp messages that arrive on this phone, as they appear in your notifications.</p>
      </div>
      <div className="card">
        <div className="lbl">What we never do</div>
        <p className="p" style={{ fontSize: 16 }}>Read old chats, send messages for you, or keep safe messages. We keep a short fingerprint and the warning phrases.</p>
      </div>
      <div className="card" style={{ gap: 14 }}>
        <div className="lbl">What should we watch?</div>
        {rows.map(([title, sub, key]) => (
          <div className="row" key={key}>
            <div className="grow">
              <b style={{ fontSize: 17 }}>{title}</b>
              {sub && <p className="sm">{sub}</p>}
            </div>
            <Toggle on={me[key]} label={title} onChange={(v) => save.mutate({ [key]: v })} />
          </div>
        ))}
      </div>
      <p className="sm">You are in control: turn this off any time in Settings.</p>
      <div className="spacer" />
      <button className="btn amber" onClick={turnOn}>Yes, turn it on</button>
      <button className="ghost" style={{ alignSelf: "center" }} onClick={() => router.push("/settings")}>Not now</button>
    </Screen>
  );
}

type Pairing = { code: string; expiresAt: string; link: string; host: string };

/** M2 · connect the Android app, and M3 · is it running? */
export function ConnectScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [removing, setRemoving] = useState<DeviceView | null>(null);
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => api<DeviceView[]>("/api/me/devices"), refetchInterval: 3000 });
  const start = useMutation({
    mutationFn: () => post<Pairing>("/api/me/devices"),
    onSuccess: (p) => {
      setPairing(p);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: "Could not start", sub: e.message, icon: "warn", tone: "red" }),
  });
  async function remove() {
    if (!removing) return;
    await api(`/api/me/devices/${removing.id}`, { method: "DELETE" });
    setRemoving(null);
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    toast({ title: "Phone disconnected", sub: "It no longer sends messages here", icon: "check" });
  }
  const paired = (devices.data ?? []).filter((d) => d.paired);
  // A phone that paired after this code was made (codes live 15 minutes, so start = expiry − 15 min).
  const codeMadeAt = pairing ? new Date(pairing.expiresAt).getTime() - 15 * 60_000 : null;
  const justPaired = codeMadeAt !== null && paired.some((d) => d.pairedAt && new Date(d.pairedAt).getTime() >= codeMadeAt);
  async function copyCode() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
    } catch {
      /* the code is on screen */
    }
    toast({ title: "Code copied", sub: "Type it in the Pause Button app", icon: "check" });
  }

  return (
    <Screen
      overlay={
        removing && (
          <Sheet onClose={() => setRemoving(null)}>
            <h2 className="h2">Disconnect this phone?</h2>
            <p className="p">Messages that arrive on it will no longer be checked. You can connect it again any time.</p>
            <button className="btn red" onClick={remove}>Yes, disconnect</button>
            <button className="btn line" onClick={() => setRemoving(null)}>Keep it</button>
          </Sheet>
        )
      }
    >
      <TitleRow title="Connect this phone" back="/watch" />
      {paired.map((d) => (
        <div className="card" key={d.id} style={{ gap: 10 }}>
          <div className="row">
            <span className="circle" style={{ width: 34, height: 34, background: d.online ? "#2E7D5B" : "var(--track)", color: "#fff" }}><Icon name="check" size={20} /></span>
            <div className="grow">
              <b style={{ fontSize: 17 }}>{d.name}</b>
              <p className="sm">{d.online ? "Connected" : `Last seen ${d.lastSeenAt ? clockTime(d.lastSeenAt) : "never"}`}</p>
            </div>
            <span className={`tag ${d.online ? "g" : ""}`}>{d.online ? "ON" : "OFF"}</span>
          </div>
          <div className="row">
            <span className={d.listenerOn ? "ok" : "no-icon"}><Icon name={d.listenerOn ? "check" : "x"} /></span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>Notification access {d.listenerOn ? "on" : "off"}</b>
              {!d.listenerOn && <p className="sm">In the app, tap “Allow notification access”.</p>}
            </div>
          </div>
          <div className="row">
            <span className={d.messagesSeen ? "ok" : "wait"} style={{ width: 26, height: 26, borderRadius: 13, background: d.messagesSeen ? "#2E7D5B" : "#F2A900", color: d.messagesSeen ? "#fff" : "#14202B", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
              {d.messagesSeen ? <Icon name="check" /> : "!"}
            </span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{d.messagesSeen ? `${d.messagesSeen} message${d.messagesSeen === 1 ? "" : "s"} checked` : "No message seen yet"}</b>
              <p className="sm">{d.lastMessageAt ? `Last one at ${clockTime(d.lastMessageAt)}.` : "Send yourself any SMS: it should appear in My checks within seconds."}</p>
            </div>
          </div>
          <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRemoving(d)}>Disconnect</button>
        </div>
      ))}

      {justPaired ? (
        <div className="card tint-green">
          <b style={{ fontSize: 17 }}>The app is connected.</b>
          <p className="sm" style={{ color: "var(--text)" }}>Now allow notification access in the app so it can see new messages.</p>
        </div>
      ) : pairing ? (
        <>
          <div className="card" style={{ gap: 10 }}>
            <div className="lbl">Your code (works for 15 minutes)</div>
            <div className="mono center-text" style={{ fontSize: 34 }}>{pairing.code}</div>
            <a className="btn amber" href={pairing.link}>Open the Pause Button app</a>
            <button className="btn line sm-btn" onClick={copyCode}>Copy code</button>
          </div>
          <div className="card" style={{ gap: 12 }}>
            <div className="lbl">On this phone</div>
            {[
              "Install the Pause Button app (APK) if you have not yet.",
              "Tap “Open the Pause Button app” above, or type the code in the app.",
              "In the app, tap “Allow notification access”, find Pause Button in the list and switch it on.",
              "Tap “Allow running in background” so the phone does not stop it.",
            ].map((step, i) => (
              <div className="row" key={i} style={{ alignItems: "flex-start" }}>
                <span className="num">{i + 1}</span>
                <span className="p" style={{ fontSize: 16 }}>{step}</span>
              </div>
            ))}
          </div>
          <p className="sm">Android shows a warning when you allow notification access. That is normal for any app that reads notifications.</p>
        </>
      ) : (
        <>
          <p className="p">The Pause Button Android app watches new SMS and WhatsApp messages and sends them here to be checked.</p>
          <div className="card" style={{ gap: 6 }}>
            <b style={{ fontSize: 17 }}>Why an app?</b>
            <p className="sm">Only an installed app can see new messages. Android asks you to allow it yourself; we cannot do it for you.</p>
          </div>
        </>
      )}
      <div className="spacer" />
      {!justPaired && (
        <button className="btn ink" disabled={start.isPending} onClick={() => start.mutate()}>
          {pairing ? "Get a new code" : paired.length ? "Connect another phone" : "Connect this phone"}
        </button>
      )}
      <button className="btn line" onClick={() => router.push("/settings")}>{justPaired || paired.length ? "Done" : "Later"}</button>
    </Screen>
  );
}
