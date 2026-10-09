"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { PhoneFrame, ToastProvider, useToast } from "@/components/ui";
import { playAlarm, unlockAudio } from "@/lib/client/alarm";
import { registerServiceWorker, resyncPush } from "@/lib/client/push";
import { api, ApiError, post } from "@/lib/client/api";
import type { FamilyState } from "@/lib/views";

const FamilyContext = createContext<UseQueryResult<FamilyState, Error> | null>(null);

export function useFamily() {
  const q = useContext(FamilyContext);
  if (!q) throw new Error("useFamily outside FamilyShell");
  return q;
}

/** The first tab's label: the person's call name when there is one person, "People" when there are several. */
export function useTabLabel() {
  const people = useFamily().data?.people ?? [];
  return people.length === 1 ? people[0].callName : "People";
}

const PLAYED_KEY = "pb-played-alerts";
function playedSet(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(PLAYED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function remember(id: string) {
  try {
    const s = playedSet();
    s.add(id);
    sessionStorage.setItem(PLAYED_KEY, JSON.stringify([...s].slice(-50)));
  } catch {
    /* storage unavailable */
  }
}

export function FamilyShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <FamilyShellInner>{children}</FamilyShellInner>
    </ToastProvider>
  );
}

function FamilyShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const q = useQuery({ queryKey: ["family-state"], queryFn: () => api<FamilyState>("/api/family/state"), refetchInterval: 2000 });
  const offline = q.error instanceof ApiError && q.error.status === 0;
  const wasOffline = useRef(false);

  // Alerts while the app is closed: install the service worker now, and re-register
  // this phone if it already has permission (push endpoints can change).
  useEffect(() => {
    void registerServiceWorker().then(() => resyncPush());
  }, []);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401 && q.fetchStatus === "idle") router.replace("/welcome");
  }, [q.error, q.fetchStatus, router]);

  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && q.data) {
      wasOffline.current = false;
      toast({ title: "Back online", sub: "Alerts are working again", icon: "wifi" });
    }
  }, [offline, q.data, toast]);

  // Not linked to anyone yet: the invite code screen.
  const linked = (q.data?.people.length ?? 0) > 0;
  useEffect(() => {
    if (q.data && !linked && !pathname.startsWith("/family/join") && !pathname.startsWith("/family/alerts-setup")) {
      router.replace("/family/join");
    }
  }, [q.data, linked, pathname, router]);

  // A new alert: buzz, flash and sound, then open it full screen (I1 / O1).
  const alerts = q.data?.alerts;
  useEffect(() => {
    if (!alerts || !q.data) return;
    const played = playedSet();
    const fresh = alerts.find((a) => !a.openedAt && !played.has(a.id));
    if (!fresh) return;
    remember(fresh.id);
    playAlarm(fresh.kind === "urgent" ? "urgent" : "quiet", { sound: q.data.me.alertSound, vibrate: q.data.me.alertVibrate });
    void post(`/api/family/alerts/${fresh.id}/played`).catch(() => {});
    const busyOnIt = fresh.holdId && pathname === `/family/hold/${fresh.holdId}`;
    if (!busyOnIt) router.push(`/family/alert/${fresh.id}`);
  }, [alerts, q.data, pathname, router]);

  return (
    <FamilyContext.Provider value={q}>
      <PhoneFrame
        overlays={
          offline && (
            <div className="banner" style={{ background: "var(--track2)", color: "var(--text)", border: 0, top: 44, padding: "10px 14px" }}>
              <div className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
                <Icon name="wifi" size={20} />
                Reconnecting…
              </div>
            </div>
          )
        }
      >
        {children}
      </PhoneFrame>
    </FamilyContext.Provider>
  );
}
