"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { PhoneFrame, useToast } from "@/components/ui";
import { playAlarm, unlockAudio } from "@/lib/client/alarm";
import { api, ApiError, post } from "@/lib/client/api";
import type { FamilyState } from "@/lib/views";

const FamilyContext = createContext<UseQueryResult<FamilyState, Error> | null>(null);

export function useFamily() {
  const q = useContext(FamilyContext);
  if (!q) throw new Error("useFamily outside FamilyShell");
  return q;
}

/** What the family member calls the protected person: "Papa" for a son or daughter. */
export function useCallName() {
  const { data } = useFamily();
  const p = data?.protectedUser;
  if (!p) return "Papa";
  return p.relation === "Son" || p.relation === "Daughter" ? "Papa" : p.name;
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
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const q = useQuery({ queryKey: ["family-state"], queryFn: () => api<FamilyState>("/api/family/state"), refetchInterval: 2000 });
  const offline = q.error instanceof ApiError && q.error.status === 0;
  const wasOffline = useRef(false);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401) router.replace("/welcome");
  }, [q.error, router]);

  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && q.data) {
      wasOffline.current = false;
      toast({ title: "Back online", sub: "Alerts are working again", icon: "wifi" });
    }
  }, [offline, q.data, toast]);

  // Not linked yet: the invite code screen.
  const linked = !!q.data?.protectedUser;
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
