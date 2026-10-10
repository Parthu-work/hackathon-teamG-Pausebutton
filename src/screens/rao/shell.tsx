"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Icon } from "@/components/icons";
import { NativeNotificationsProvider } from "@/components/native-notifications";
import { PhoneFrame, ToastProvider, useToast } from "@/components/ui";
import { bcp47, joinNamesIn, translator, type T } from "@/lib/i18n";
import { api, ApiError, post } from "@/lib/client/api";
import { registerServiceWorker, resyncPush } from "@/lib/client/push";
import type { Language, RaoState } from "@/lib/views";

const RaoContext = createContext<UseQueryResult<RaoState, Error> | null>(null);

/** Mr Rao's state, polled every 2 s (the design's "polling every 2 s"). */
export function useRao() {
  const q = useContext(RaoContext);
  if (!q) throw new Error("useRao outside RaoShell");
  return q;
}

/** The language Mr Rao chose in Settings (F5): "en" until his state has loaded. */
export function useLang(): Language {
  return useRao().data?.me.language ?? "en";
}

/** t("home.doorCall") in Mr Rao's language, with {name} placeholders filled from the second argument. */
export function useT(): T {
  const lang = useLang();
  return useMemo(() => translator(lang), [lang]);
}

/** "Arjun and Meera" with the language's own "and". */
export function useJoinNames() {
  const t = useT();
  return (names: string[]) => joinNamesIn(t, names);
}

export function useHelper() {
  const { data } = useRao();
  const t = useT();
  const names = data?.helperNames ?? [];
  const linked = (data?.people ?? []).filter((p) => p.status === "linked");
  return {
    first: names[0] ?? t("common.yourFamily"),
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
  const lang = q.data?.me.language ?? "en";
  const t = useMemo(() => translator(lang), [lang]);

  // The page's language follows his choice, so screen readers and fonts do too.
  useEffect(() => {
    document.documentElement.lang = bcp47(lang).slice(0, 2);
  }, [lang]);

  // Alerts while the app is closed (a message the watcher caught, the family's
  // decision): install the service worker now (the Android app needs none), and
  // re-register this phone for him if it already has permission (endpoints,
  // keys and FCM tokens can change).
  useEffect(() => {
    void registerServiceWorker().then(() => resyncPush("rao"));
  }, []);

  // In the Android app: why we ask before Android's notification prompt, and what to do when they are off.
  const notifications = useMemo(
    () => ({
      why: t("settings.notifyWhy"),
      whySub: t("settings.notifyWhySub"),
      continue: t("settings.notifyContinue"),
      notNow: t("common.notNow"),
      off: t("settings.notifyAppOff"),
      offSub: t("settings.notifyAppOffSub"),
      openSettings: t("settings.notifyOpenSettings"),
    }),
    [t],
  );

  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401 && q.fetchStatus === "idle") router.replace("/welcome");
  }, [q.error, q.fetchStatus, router]);

  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (wasOffline.current && q.data) {
      wasOffline.current = false;
      toast({ title: t("common.backOnline"), sub: t("common.checksWorking"), icon: "wifi" });
    }
  }, [offline, q.data, toast, t]);

  // "This screen opens when Arjun decides": jump to the outcome (H3/H4).
  const outcomeId = q.data?.outcome?.id;
  useEffect(() => {
    if (outcomeId && pathname !== `/hold/${outcomeId}`) router.push(`/hold/${outcomeId}`);
  }, [outcomeId, pathname, router]);

  const banner = q.data?.banner;
  const showBanner = banner && !pathname.startsWith("/check/") && !pathname.startsWith("/hold/") && !pathname.startsWith("/call");
  const helperName = q.data?.helperNames[0] ?? t("common.yourFamily");

  async function onBanner(action: "see" | "tell") {
    if (!banner) return;
    await post(`/api/me/inbox/${banner.id}/seen`).catch(() => {});
    if (action === "tell" && banner.checkId) {
      await post(`/api/me/checks/${banner.checkId}/ask`).catch(() => {});
      toast({ title: t("banner.told", { name: helperName }), sub: t("banner.seePhrases"), icon: "bell" });
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
                  {t("common.reconnecting")}
                </div>
              </div>
            )}
            {showBanner && !offline && (
              <div className={`banner ${banner.verdict === "SUSPICIOUS" ? "amber-edge" : ""}`} role="alert">
                <div className="row" style={{ gap: 8 }}>
                  <span className="pm" style={{ gap: 3 }}><i /><i /></span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em" }}>{t("banner.now")}</span>
                </div>
                <b style={{ fontSize: 18, lineHeight: 1.25 }}>
                  {t("banner.possible", { verdict: t(`verdictLabel.${banner.verdict as "SCAM" | "SUSPICIOUS" | "SAFE"}`), sender: banner.sender })}
                </b>
                <span style={{ fontSize: 15, lineHeight: 1.35, color: "#ECE8E0" }}>
                  {banner.phrases.length ? `“${banner.phrases.join("”, “")}”` : banner.text ? banner.text.slice(0, 60) + "…" : ""} {t("banner.doNotReply")}
                </span>
                <div className="row" style={{ gap: 10, marginTop: 2 }}>
                  <button className="btn amber" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => onBanner("see")}>
                    {t("banner.seeWhy")}
                  </button>
                  <button className="btn whiteline" style={{ minHeight: 44, fontSize: 15, borderRadius: 12 }} onClick={() => onBanner("tell")}>
                    {t("banner.tell", { name: helperName })}
                  </button>
                </div>
              </div>
            )}
          </>
        }
      >
        <NativeNotificationsProvider app="rao" copy={notifications} wanted={q.data?.me.alertNotify ?? false}>{children}</NativeNotificationsProvider>
      </PhoneFrame>
    </RaoContext.Provider>
  );
}
