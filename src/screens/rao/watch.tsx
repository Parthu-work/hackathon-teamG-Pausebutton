"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, LoadingScreen, Screen, Sheet, TitleRow, Toggle, useClientValue, useToast } from "@/components/ui";
import { api, post } from "@/lib/client/api";
import { isNativeApp, nativeBridge, onAppResume, type PauseButtonNativePlugin } from "@/lib/client/native";
import type { DeviceView } from "@/lib/views";
import { useHelper, useRao } from "./shell";

// M1–M4: the real message watcher. The Android app reads incoming SMS and
// WhatsApp notifications and sends them here, where they go through the same
// check as a pasted message (and show up in My checks and the inbox).

// Said on the consent screen, and again before Android's notification access settings.
const WHAT_WE_READ = "The text of new SMS and WhatsApp messages that arrive on this phone, as they appear in your notifications.";
const WHAT_WE_NEVER_DO = "Read old chats, send messages for you, or keep the text of a safe message or of one we do not check.";

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
        <p className="p" style={{ fontSize: 16 }}>{WHAT_WE_READ}</p>
      </div>
      <div className="card">
        <div className="lbl">What we never do</div>
        <p className="p" style={{ fontSize: 16 }}>{WHAT_WE_NEVER_DO}</p>
      </div>
      <div className="card">
        <div className="lbl">What we keep</div>
        <p className="p" style={{ fontSize: 16 }}>
          For each message we check: a fingerprint, who sent it, the verdict and the warning phrases. The text of a scam or suspicious message is kept
          for 24 hours so {helper.first} can read it. Messages that need a closer look are also read by Claude (Anthropic).
        </p>
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

/** "10:42" today, "9 Oct 22:10" on an earlier day. */
function when(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? clockTime(iso) : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clockTime(iso)}`;
}

const messages = (n: number) => `${n} message${n === 1 ? "" : "s"}`;

/**
 * M2 · connect the Android app, and M3 · is it running? Inside the Android
 * app the phone connects itself and asks Android for what it needs; in a
 * browser, a code (and a link) for the app on the phone to be watched.
 */
export function ConnectScreen() {
  // Null while rendering on the server: which of the two only the phone knows.
  const native = useClientValue<boolean | null>(isNativeApp, null);
  if (native === null) return <LoadingScreen />;
  return native ? <ConnectInApp bridge={nativeBridge()!} /> : <ConnectWithCode />;
}

/** The phones connected to his account (what the server knows of each), and "Disconnect" for any of them. */
function usePhones() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<DeviceView | null>(null);
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => api<DeviceView[]>("/api/me/devices"), refetchInterval: 3000 });
  async function remove() {
    if (!removing) return;
    await api(`/api/me/devices/${removing.id}`, { method: "DELETE" });
    setRemoving(null);
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    toast({ title: "Phone disconnected", sub: "It no longer sends messages here", icon: "check" });
  }
  const sheet = removing && (
    <Sheet onClose={() => setRemoving(null)}>
      <h2 className="h2">Disconnect this phone?</h2>
      <p className="p">Messages that arrive on it will no longer be checked. You can connect it again any time.</p>
      <button className="btn red" onClick={remove}>Yes, disconnect</button>
      <button className="btn line" onClick={() => setRemoving(null)}>Keep it</button>
    </Sheet>
  );
  const paired = (devices.data ?? []).filter((d) => d.paired);
  const cards = paired.map((d) => <PhoneCard key={d.id} d={d} onDisconnect={() => setRemoving(d)} />);
  return { paired, cards, sheet };
}

/** One connected phone: on or off, notification access, what it checked, and whether it still syncs. */
function PhoneCard({ d, onDisconnect }: { d: DeviceView; onDisconnect: () => void }) {
  const sync = [d.lastSyncAt && `Last sync at ${when(d.lastSyncAt)}`, d.waiting > 0 && `${messages(d.waiting)} waiting to be sent`].filter(Boolean).join(" · ");
  return (
    <div className="card" style={{ gap: 10 }} data-testid="phone-card">
      <div className="row">
        <span className="circle" style={{ width: 34, height: 34, background: d.online ? "#2E7D5B" : "var(--track)", color: "#fff" }}><Icon name="check" size={20} /></span>
        <div className="grow">
          <b style={{ fontSize: 17 }}>{d.name}</b>
          <p className="sm">{d.online ? "Connected" : `Last seen ${d.lastSeenAt ? clockTime(d.lastSeenAt) : "never"}`}</p>
        </div>
        <span className={`tag ${d.online ? "g" : ""}`}>{d.online ? "ON" : "OFF"}</span>
      </div>
      {d.notSyncing && (
        <div className="card tint-red row-card" style={{ padding: 12, boxShadow: "none" }} data-testid="not-syncing">
          <span className="no-icon"><Icon name="x" /></span>
          <div className="grow">
            <b style={{ fontSize: 16 }}>Not syncing since {d.lastSeenAt ? when(d.lastSeenAt) : "it was connected"}</b>
            <p className="sm" style={{ color: "var(--text)" }}>Open the Pause Button app on that phone.</p>
          </div>
        </div>
      )}
      <div className="row">
        <span className={d.listenerOn ? "ok" : "no-icon"}><Icon name={d.listenerOn ? "check" : "x"} /></span>
        <div className="grow">
          <b style={{ fontSize: 16 }}>Notification access {d.listenerOn ? "on" : "off"}</b>
          {!d.listenerOn && <p className="sm">Allow it in the Pause Button app on that phone.</p>}
        </div>
      </div>
      <div className="row">
        <span className={d.messagesSeen ? "ok" : "wait"} style={{ width: 26, height: 26, borderRadius: 13, background: d.messagesSeen ? "#2E7D5B" : "#F2A900", color: d.messagesSeen ? "#fff" : "#14202B", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
          {d.messagesSeen ? <Icon name="check" /> : "!"}
        </span>
        <div className="grow">
          <b style={{ fontSize: 16 }}>{d.messagesSeen ? `${messages(d.messagesSeen)} checked` : "No message seen yet"}</b>
          <p className="sm">{d.lastMessageAt ? `Last one at ${clockTime(d.lastMessageAt)}.` : "Send yourself any SMS: it should appear in My checks within seconds."}</p>
        </div>
      </div>
      {sync && <p className="sm" data-testid="phone-sync">{sync}</p>}
      <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={onDisconnect}>Disconnect</button>
    </div>
  );
}

/** In a browser: a code, and a link that opens the Android app on the phone to be watched. */
function ConnectWithCode() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const { paired, cards, sheet } = usePhones();
  const start = useMutation({
    mutationFn: () => post<Pairing>("/api/me/devices"),
    onSuccess: (p) => {
      setPairing(p);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: "Could not start", sub: e.message, icon: "warn", tone: "red" }),
  });
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
    <Screen overlay={sheet}>
      <TitleRow title="Connect this phone" back="/watch" />
      {cards}

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

/**
 * Inside the Android app: this phone connects itself (a code from the server,
 * traded natively for the watcher's token), then asks Android for message
 * reading and for running in the background, each after saying why. Saying no
 * is fine: he can still paste or forward messages.
 */
function ConnectInApp({ bridge }: { bridge: PauseButtonNativePlugin }) {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { cards, sheet } = usePhones();
  const watcher = useQuery({ queryKey: ["native-watcher"], queryFn: () => bridge.watcherStatus(), refetchInterval: 3000 });
  const [explain, setExplain] = useState<"reading" | "battery" | "disconnect" | null>(null);
  const [cameBack, setCameBack] = useState(false);

  // Back from Android's settings (or anywhere else): read the watcher again at once.
  useEffect(
    () =>
      onAppResume(() => {
        setCameBack(true);
        void queryClient.invalidateQueries({ queryKey: ["native-watcher"] });
        void queryClient.invalidateQueries({ queryKey: ["devices"] });
      }),
    [queryClient],
  );

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["native-watcher"] }), queryClient.invalidateQueries({ queryKey: ["devices"] })]);
  }
  const connect = useMutation({
    mutationFn: async () => {
      const { code } = await post<Pairing>("/api/me/devices");
      const result = await bridge.pair({ code, host: window.location.origin });
      if (!result.ok) throw new Error(result.error || "The phone could not connect. Try again.");
    },
    onSuccess: async () => {
      await refresh();
      toast({ title: "This phone is connected", sub: "Now allow message reading", icon: "check" });
    },
    onError: (e) => toast({ title: "Could not connect this phone", sub: e.message, icon: "warn", tone: "red" }),
  });
  async function go(step: "reading" | "battery") {
    setExplain(null);
    await (step === "reading" ? bridge.openListenerSettings() : bridge.openBatterySettings()).catch(() => {});
  }
  async function disconnect() {
    setExplain(null);
    await bridge.disconnect().catch(() => {});
    await refresh();
    toast({ title: "Phone disconnected", sub: "It no longer sends messages here", icon: "check" });
  }

  const w = watcher.data;
  if (!w && watcher.isError) {
    // An app from before the bridge: it cannot connect itself.
    return (
      <Screen>
        <TitleRow title="Connect this phone" back="/watch" />
        <div className="card tint-red">
          <b style={{ fontSize: 17 }}>This version of the app cannot watch messages.</b>
          <p className="sm" style={{ color: "var(--text)" }}>Install the latest Pause Button app, then try again. You can still paste or forward messages.</p>
        </div>
        <div className="spacer" />
        <button className="btn line" onClick={() => router.push("/settings")}>Later</button>
      </Screen>
    );
  }
  if (!w) return <LoadingScreen />;
  const reading = w.consented && w.listenerOn;

  const overlay =
    (explain === "reading" && (
      <Sheet onClose={() => setExplain(null)}>
        <h2 className="h2">Allow message reading</h2>
        <div className="card" style={{ boxShadow: "none" }}>
          <div className="lbl">What we read</div>
          <p className="p" style={{ fontSize: 16 }}>{WHAT_WE_READ}</p>
        </div>
        <div className="card" style={{ boxShadow: "none" }}>
          <div className="lbl">What we never do</div>
          <p className="p" style={{ fontSize: 16 }}>{WHAT_WE_NEVER_DO}</p>
        </div>
        <p className="sm">
          {w.consented ? "" : "First agree to what Pause Button reads. "}
          Then Android shows a list of apps: find Pause Button and switch it on. Android warns you when you do; that is normal for any app that reads
          notifications.
        </p>
        <button className="btn amber" onClick={() => void go("reading")} data-testid="reading-continue">Continue</button>
        <button className="btn line" onClick={() => setExplain(null)}>Not now</button>
      </Sheet>
    )) ||
    (explain === "battery" && (
      <Sheet onClose={() => setExplain(null)}>
        <h2 className="h2">Allow running in the background</h2>
        <p className="p">Android stops apps in the background to save battery. Allow Pause Button to keep running, so a message is checked the moment it arrives.</p>
        <p className="sm">Android asks you to confirm. If you say no, messages are still checked, sometimes later.</p>
        <button className="btn amber" onClick={() => void go("battery")} data-testid="battery-continue">Continue</button>
        <button className="btn line" onClick={() => setExplain(null)}>Not now</button>
      </Sheet>
    )) ||
    (explain === "disconnect" && (
      <Sheet onClose={() => setExplain(null)}>
        <h2 className="h2">Disconnect this phone?</h2>
        <p className="p">Messages that arrive on it will no longer be checked. You can connect it again any time.</p>
        <button className="btn red" onClick={() => void disconnect()}>Yes, disconnect</button>
        <button className="btn line" onClick={() => setExplain(null)}>Keep it</button>
      </Sheet>
    )) ||
    sheet;

  return (
    <Screen overlay={overlay}>
      <TitleRow title="Connect this phone" back="/watch" />
      {w.paired ? (
        <div className="card" style={{ gap: 12 }} data-testid="this-phone">
          <div className="lbl">This phone</div>
          <div className="row">
            <span className="ok"><Icon name="check" /></span>
            <b className="grow" style={{ fontSize: 16 }}>Connected{w.userName ? ` as ${w.userName}` : ""}</b>
          </div>
          <div className="row">
            <span className={reading ? "ok" : "no-icon"}><Icon name={reading ? "check" : "x"} /></span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{reading ? "Message reading is on" : "Message reading is off"}</b>
              {!reading && <p className="sm">Pause Button needs it to see new messages.</p>}
            </div>
          </div>
          {!reading && <button className="btn amber sm-btn" onClick={() => setExplain("reading")}>Allow message reading</button>}
          <div className="row">
            <span className={w.batteryUnrestricted ? "ok" : "no-icon"} style={w.batteryUnrestricted ? undefined : { background: "#F2A900", color: "#14202B" }}>
              {w.batteryUnrestricted ? <Icon name="check" /> : "!"}
            </span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{w.batteryUnrestricted ? "Allowed to run in the background" : "The phone may stop Pause Button to save battery"}</b>
            </div>
          </div>
          {!w.batteryUnrestricted && <button className="btn line sm-btn" onClick={() => setExplain("battery")}>Allow running in the background</button>}
          {w.waiting > 0 && (
            <p className="sm">
              {messages(w.waiting)} waiting to be sent{w.lastError ? ` (${w.lastError})` : ""}. They go as soon as the phone is online.
            </p>
          )}
          {w.today && <p className="sm">{w.today}</p>}
          <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => setExplain("disconnect")}>Disconnect this phone</button>
        </div>
      ) : (
        <>
          <p className="p">Pause Button can watch new SMS and WhatsApp messages on this phone and check them for you.</p>
          <div className="card" style={{ gap: 6 }}>
            <b style={{ fontSize: 17 }}>Android asks you first</b>
            <p className="sm">After connecting, allow message reading and running in the background. We say why before each one.</p>
          </div>
        </>
      )}

      {w.paired && !reading && cameBack && (
        <div className="card tint-amber" data-testid="cannot-read">
          <p className="p" style={{ fontSize: 16 }}>Pause Button can&apos;t check messages automatically. You can still paste or forward them.</p>
        </div>
      )}

      {cards.length > 0 && <div className="lbl">Connected phones</div>}
      {cards}
      <div className="spacer" />
      {!w.paired && (
        <button className="btn ink" disabled={connect.isPending} onClick={() => connect.mutate()}>
          {connect.isPending ? "Connecting…" : "Connect this phone"}
        </button>
      )}
      <button className="btn line" onClick={() => router.push("/settings")}>{w.paired ? "Done" : "Later"}</button>
    </Screen>
  );
}
