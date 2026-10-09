"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { PhoneFrame, ToastProvider, useToast } from "@/components/ui";
import { api, ApiError, post } from "@/lib/client/api";
import type { RaoState } from "@/lib/views";

const RaoContext = createContext<UseQueryResult<RaoState, Error> | null>(null);

/** Mr Rao's state, polled every 2 s (the design's "polling every 2 s"). */
export function useRao() {
  const q = useContext(RaoContext);
  if (!q) throw new Error("useRao outside RaoShell");
  return q;
}

export function useHelper() {
  const { data } = useRao();
  const names = data?.helperNames ?? [];
  const linked = (data?.people ?? []).filter((p) => p.status === "linked");
  return {
    first: names[0] ?? "your family",
    all: names,
    /** Phone of the first trusted person, for "Call Arjun". */
    phone: linked[0]?.phone ?? null,
    phoneOf: (name: string) => (data?.people ?? []).find((p) => p.name === name)?.phone ?? null,
  };
}

export function RaoShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <RaoShellInner>{children}</RaoShellInner>
    </ToastProvider>
  );
}

function RaoShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["rao-state"], queryFn: () => api<RaoState>("/api/me/state"), refetchInterval: 2000 });
  const offline = q.error instanceof ApiError && q.error.status === 0;
  const wasOffline = useRef(false);

  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401 && q.fetchStatus === "idle") router.replace("/welcome");
  }, [q.error, q.fetchStatus, router]);

  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && q.data) {
      wasOffline.current = false;
      toast({ title: "Back online", sub: "Checks are working again", icon: "wifi" });
    }
  }, [offline, q.data, toast]);

  // "This screen opens when Arjun decides": jump to the outcome (H3/H4).
  const outcomeId = q.data?.outcome?.id;
  useEffect(() => {
    if (outcomeId && pathname !== `/hold/${outcomeId}`) router.push(`/hold/${outcomeId}`);
  }, [outcomeId, pathname, router]);

  const banner = q.data?.banner;
  const showBanner = banner && !pathname.startsWith("/check/") && !pathname.startsWith("/hold/");

  async function onBanner(action: "see" | "tell") {
    if (!banner) return;
    await post(`/api/me/inbox/${banner.id}/seen`).catch(() => {});
    if (action === "tell" && banner.checkId) {
      await post(`/api/me/checks/${banner.checkId}/ask`).catch(() => {});
      toast({ title: `${q.data?.helperNames[0] ?? "Your family"} has been told`, sub: "They can see the warning phrases", icon: "bell" });
    }
    await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
    if (banner.checkId) router.push(`/check/${banner.checkId}`);
  }

  return (
    <RaoContext.Provider value={q}>
      <PhoneFrame
        size={q.data?.me.textSize}
        overlays={
          <>
            {offline && (
              <div className="banner" style={{ background: "var(--track2)", color: "var(--text)", border: 0, top: 44, padding: "10px 14px" }}>
                <div className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
                  <Icon name="wifi" size={20} />
                  Reconnecting…
                </div>
              </div>
            )}
            {showBanner && !offline && (
              <div className={`banner ${banner.verdict === "SUSPICIOUS" ? "amber-edge" : ""}`} role="alert">
                <div className="row" style={{ gap: 8 }}>
                  <span className="pm" style={{ gap: 3 }}><i /><i /></span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em" }}>PAUSE BUTTON · NOW</span>
                </div>
                <b style={{ fontSize: 18, lineHeight: 1.25 }}>
                  Possible {banner.verdict} from {banner.sender}
                </b>
                <span style={{ fontSize: 15, lineHeight: 1.35, color: "#ECE8E0" }}>
                  {banner.phrases.length ? `“${banner.phrases.join("”, “")}”` : banner.text.slice(0, 60) + "…"} Do not reply.
                </span>
                <div className="row" style={{ gap: 10, marginTop: 2 }}>
                  <button className="btn amber" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => onBanner("see")}>
                    See why
                  </button>
                  <button className="btn whiteline" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => onBanner("tell")}>
                    Tell {q.data?.helperNames[0] ?? "family"}
                  </button>
                </div>
              </div>
            )}
          </>
        }
      >
        {children}
      </PhoneFrame>
    </RaoContext.Provider>
  );
}
