"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Avatar, clockTime, Marks, RaoTabs, Screen, Sheet, TitleRow, Toggle, useToast, VerdictPill } from "@/components/ui";
import { LANGUAGES } from "@/lib/i18n";
import type { CheckRow } from "@/lib/server/checks";
import { deleteMyAccount } from "@/lib/client/account";
import { api, ApiError } from "@/lib/client/api";
import { forgetMessages } from "@/lib/client/messages";
import { pushPermission, subscribeToPush, unsubscribeFromPush } from "@/lib/client/push";
import { signOut } from "@/lib/client/sign-out";
import { useRao, useT } from "./shell";

const noSubscribe = () => () => {};
const pushPermissionNow = () => pushPermission();
const pushPermissionServer = () => "" as const;

function useRaoTabs(active: "check" | "checks" | "settings") {
  const t = useT();
  return <RaoTabs active={active} labels={{ check: t("common.tabCheck"), checks: t("common.tabChecks"), settings: t("common.tabSettings") }} />;
}

/** "Today 12:41" / "Yesterday" / "2 Oct", in Mr Rao's language. */
function dayLabel(t: ReturnType<typeof useT>, iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return `${t("history.today")} ${clockTime(iso)}`;
  if (d.toDateString() === yesterday.toDateString()) return t("history.yesterday");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** K1 · My checks · Q1 empty · Q2 loading · F14b failed load · F14c search and filters */
export function HistoryScreen() {
  const router = useRouter();
  const t = useT();
  const tabs = useRaoTabs("checks");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "scams" | "safe">("all");
  const q = useQuery({ queryKey: ["checks"], queryFn: () => api<CheckRow[]>("/api/me/checks"), refetchInterval: 5000 });

  const header = (
    <div className="row"><span className="pm"><i /><i /></span><b className="grow display" style={{ fontSize: 20 }}>{t("history.title")}</b></div>
  );

  if (q.isPending) {
    return (
      <Screen tabs={tabs}>
        {header}
        <div className="in" style={{ gap: 10, minHeight: 52, color: "var(--muted)" }}><Icon name="search" />{t("history.search")}</div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card" style={{ gap: 10 }}>
            <div className="row">
              <span className="sk" style={{ flex: "none", width: 44, height: 44, borderRadius: 12 }} />
              <div className="grow col"><span className="sk" style={{ width: "70%" }} /><span className="sk" style={{ width: "45%", height: 10 }} /></div>
              <span className="sk" style={{ flex: "none", width: 64, height: 28, borderRadius: 14 }} />
            </div>
          </div>
        ))}
      </Screen>
    );
  }

  // F14b · A failed load stops pretending to be an empty list.
  if (q.isError && !q.data) {
    return (
      <Screen tabs={tabs}>
        {header}
        <div className="card tint-amber" style={{ gap: 6, marginTop: 12 }}>
          <div className="row"><Icon name="wifi" /><b style={{ fontSize: 19 }}>{t("history.couldNotLoad")}</b></div>
          <p className="p" style={{ fontSize: 16 }}>{t("history.notSameAsNone")}</p>
          {!(q.error instanceof ApiError && q.error.status === 0) && <p className="sm">{q.error.message}</p>}
        </div>
        <button className="btn amber" onClick={() => void q.refetch()}>{t("common.tryAgain")}</button>
        <div className="spacer" />
      </Screen>
    );
  }

  const rows = q.data ?? [];
  if (!rows.length) {
    return (
      <Screen tabs={tabs}>
        {header}
        <div style={{ display: "flex", justifyContent: "center", margin: "18px 0 6px" }}>
          <span className="circle" style={{ width: 120, height: 120, background: "var(--amber-tint)", boxShadow: "0 0 0 14px rgba(242,169,0,.10)" }}>
            <span className="pm" style={{ gap: 8 }}><i style={{ width: 14, height: 48, borderRadius: 5 }} /><i style={{ width: 14, height: 48, borderRadius: 5 }} /></span>
          </span>
        </div>
        <h1 className="h1 center-text">{t("history.noChecks")}</h1>
        <p className="p center-text" style={{ color: "var(--muted)" }}>{t("history.noChecksBody")}</p>
        <div className="spacer" />
        <button className="btn amber" onClick={() => router.push("/")}>{t("history.checkMessage")}</button>
      </Screen>
    );
  }

  // F14c · Search that is there when the list is.
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter === "scams" && r.verdict === "SAFE") return false;
    if (filter === "safe" && r.verdict !== "SAFE") return false;
    if (!needle) return true;
    return [r.title, r.checkedBy ?? "", ...r.phrases, t(`verdictLabel.${r.verdict}`)].some((s) => s.toLowerCase().includes(needle));
  });
  const sourceTag = (r: CheckRow) =>
    r.source === "share" ? t("history.forwarded") : r.source === "voice" ? t("history.spoken") : r.source === "call" ? t("history.call") : r.source === "sms" ? "SMS" : r.source === "whatsapp" ? "WhatsApp" : null;

  return (
    <Screen tabs={tabs}>
      <h1 className="h1">{t("history.title")}</h1>
      <label className="in" style={{ gap: 10, minHeight: 52 }}>
        <Icon name="search" />
        <input aria-label={t("history.search")} placeholder={t("history.search")} value={query} onChange={(e) => setQuery(e.target.value)} style={{ height: 48 }} />
        {query && <button className="ghost" style={{ minHeight: 36, padding: "0 6px" }} aria-label={t("home.clear")} onClick={() => setQuery("")}><Icon name="x" size={18} /></button>}
      </label>
      <div className="row" style={{ gap: 8 }}>
        {(["all", "scams", "safe"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`history.${f}`)}</button>
        ))}
      </div>
      {!shown.length && <p className="p" style={{ color: "var(--muted)" }}>{t("history.noMatch", { q: query })}</p>}
      {shown.map((r) => (
        <Link key={r.id} href={`/check/${r.id}`} className="card" style={{ textDecoration: "none" }}>
          <div className="row">
            <VerdictPill verdict={r.verdict} size="small" icon={false} label={t(`verdictLabel.${r.verdict}`)} />
            {sourceTag(r) && <span className="tag">{sourceTag(r)!.toUpperCase()}</span>}
            <span className="grow" />
            <span className="sm">{dayLabel(t, r.createdAt)}{r.holdStatus === "blocked" ? ` · ${t("history.blocked")}` : ""}</span>
          </div>
          <b style={{ fontSize: 17 }}>{r.title}</b>
          {r.checkedBy && (
            <p className="sm" style={{ color: "var(--text)", fontWeight: 700 }}>
              {t("history.checkedBy", { name: r.checkedBy, verdict: r.verdict === "SAFE" ? t("common.notAScam") : t("common.aScam") })}
            </p>
          )}
          {r.phrases.length ? <Marks phrases={r.phrases} size={15} /> : r.verdict === "SAFE" && !r.checkedBy && <p className="sm">{t("history.noWarnings")}</p>}
        </Link>
      ))}
      <div className="spacer" />
      <p className="sm center-text">{t("history.keepPhrases")}</p>
    </Screen>
  );
}

/** K2 · Settings */
export function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const toast = useToast();
  const tabs = useRaoTabs("settings");
  const { data } = useRao();
  // Reads Notification.permission on every render; "" while rendering on the server.
  const permission = useSyncExternalStore(noSubscribe, pushPermissionNow, pushPermissionServer);
  const [, bump] = useState(0);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/me/settings", { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rao-state"] }),
  });
  if (!data) return null;
  const first = data.people.find((p) => p.status === "linked") ?? data.people[0];
  const watching = data.me.watchSms || data.me.watchWhatsapp;
  const relation = (r: string) => (r === "Son" ? t("settings.son") : r === "Daughter" ? t("settings.daughter") : r === "Spouse" ? t("settings.spouse") : t("settings.friend"));
  const lang = LANGUAGES.find((l) => l.code === data.me.language) ?? LANGUAGES[0];

  // K2 · Notifications on his own phone: a message the watcher caught, the family's decision.
  const notifyText =
    !permission || !data.me.alertNotify
      ? t("settings.notifySub")
      : permission === "granted"
        ? t("settings.notifyOn")
        : permission === "denied"
          ? t("settings.notifyBlocked")
          : permission === "needs-install"
            ? t("settings.notifyInstall")
            : permission === "unsupported"
              ? t("settings.notifyUnsupported")
              : t("settings.notifyAsk");
  async function onNotify(on: boolean) {
    if (on) {
      const result = await subscribeToPush("rao"); // asks the phone's permission: must follow the tap
      const key =
        result === "subscribed" ? "settings.notifyOn"
        : result === "denied" ? "settings.notifyBlocked"
        : result === "needs-install" ? "settings.notifyInstall"
        : result === "unsupported" ? "settings.notifyUnsupported"
        : result === "off" ? "settings.notifyOff"
        : "settings.notifyError";
      toast({ title: t("settings.notify"), sub: t(key), icon: result === "subscribed" ? "bell" : "warn", tone: result === "subscribed" ? undefined : "red" });
      bump((n) => n + 1); // re-read the permission
    } else {
      await unsubscribeFromPush("rao");
    }
    save.mutate({ alertNotify: on });
  }

  async function leave() {
    await signOut("rao");
    queryClient.clear();
    router.push("/welcome");
  }

  return (
    <Screen tabs={tabs}>
      <h1 className="h1">{t("settings.title")}</h1>
      <div className="card row-card">
        {first ? <Avatar name={first.name} size={44} /> : <span className="circle" style={{ width: 44, height: 44, background: "var(--chip)" }}><Icon name="people" /></span>}
        <div className="grow">
          <b style={{ fontSize: 17 }}>{first ? `${first.name} · ${relation(first.relation)}` : t("settings.noTrusted")}</b>
          <p className="sm">{data.people.length > 1 ? t("settings.yourTrustedN", { n: data.people.length }) : t("settings.yourTrusted")}</p>
        </div>
        <button className="ghost" onClick={() => router.push("/settings/people")}>{t("settings.change")}</button>
      </div>
      <div className="card">
        <div className="lbl">{t("settings.textSize")}</div>
        <div className="row" style={{ gap: 8 }}>
          {(["A", "A+", "A++"] as const).map((s, i) => (
            <button key={s} className={`chip ${data.me.textSize === s ? "on" : ""}`} style={{ fontSize: 16 + i * 4 }} onClick={() => save.mutate({ textSize: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <Link href="/settings/language" className="card row-card" style={{ textDecoration: "none" }} data-testid="language-row">
        <span className="circle" style={{ width: 44, height: 44, background: "var(--chip)" }}><Icon name="globe" /></span>
        <div className="grow">
          <b style={{ fontSize: 17 }}>{t("settings.language")}</b>
          <p className="sm">{lang.native}{lang.code !== "en" ? ` · ${lang.name}` : ""}</p>
        </div>
        <Icon name="chev" />
      </Link>
      <Link href="/watch" className="card row-card" style={{ textDecoration: "none" }}>
        <div className="grow">
          <b style={{ fontSize: 17 }}>{t("settings.watch")}</b>
          <p className="sm">{t("settings.watchSub")}</p>
        </div>
        <span className={`tag ${watching ? "g" : ""}`}>{watching ? t("settings.on") : t("settings.off")}</span>
        <Icon name="chev" />
      </Link>
      <div className="card row-card" data-testid="notify-row">
        <span className="circle" style={{ width: 44, height: 44, background: "var(--chip)" }}><Icon name="bell" /></span>
        <div className="grow">
          <b style={{ fontSize: 17 }}>{t("settings.notify")}</b>
          <p className="sm">{notifyText}</p>
        </div>
        <Toggle on={data.me.alertNotify} label={t("settings.notify")} onChange={(v) => void onNotify(v)} />
      </div>
      <Link href="/privacy" className="card row-card" style={{ textDecoration: "none" }}>
        <div className="grow"><b style={{ fontSize: 17 }}>{t("settings.whatWeKeep")}</b><p className="sm">{t("settings.privacySub")}</p></div>
        <Icon name="chev" />
      </Link>
      <div className="spacer" />
      <button className="ghost" style={{ alignSelf: "center" }} onClick={leave}>{t("settings.signOut")}</button>
    </Screen>
  );
}

/** P3 · What we keep (privacy) */
export function PrivacyScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  const { data } = useRao();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [confirmAccount, setConfirmAccount] = useState(false);
  const helper = data?.helperNames[0] ?? t("common.family");
  const watching = !!data && (data.me.watchSms || data.me.watchWhatsapp);

  async function deleteHistory() {
    const { kept } = await api<{ kept: number }>("/api/me/checks", { method: "DELETE" });
    forgetMessages();
    setConfirm(false);
    await queryClient.invalidateQueries();
    toast({ title: t("privacy.deleted"), sub: kept ? t("privacy.deletedKeptSub") : t("privacy.deletedSub"), icon: "trash" });
  }

  async function deleteAccount() {
    try {
      await deleteMyAccount("rao");
    } catch (e) {
      setConfirmAccount(false);
      const onHold = e instanceof ApiError && e.status === 409;
      toast({ title: t("account.failed"), sub: onHold ? t("account.onHold") : (e as Error).message, icon: "warn", tone: "red" });
      return;
    }
    queryClient.clear();
    router.push("/welcome");
  }

  async function toggleWatching() {
    await api("/api/me/settings", { method: "PATCH", body: { watchSms: !watching, watchWhatsapp: !watching } });
    await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
    toast({ title: watching ? t("privacy.watchingOff") : t("privacy.watchingOn"), sub: watching ? t("privacy.notChecked") : t("privacy.checked"), icon: "eye" });
  }

  // Every line here is in docs/retention.md: change both together.
  const keep = [t("privacy.keep1"), t("privacy.keep2"), t("privacy.keep3", { helper }), t("privacy.keep4", { helper }), t("privacy.keep5")];
  const never = [t("privacy.never1", { helper }), t("privacy.never2"), t("privacy.never3")];
  return (
    <Screen
      overlay={
        (confirm && (
          <Sheet onClose={() => setConfirm(false)}>
            <h2 className="h2">{t("privacy.deleteQ")}</h2>
            <p className="p">{t("privacy.deleteBody")}</p>
            <button className="btn red" onClick={deleteHistory}>{t("privacy.yesDelete")}</button>
            <button className="btn line" onClick={() => setConfirm(false)}>{t("privacy.keepIt")}</button>
          </Sheet>
        )) ||
        (confirmAccount && (
          <Sheet onClose={() => setConfirmAccount(false)}>
            <h2 className="h2">{t("account.deleteQ")}</h2>
            <p className="p">{t("account.deleteBody", { helper })}</p>
            <button className="btn red" onClick={deleteAccount} data-testid="confirm-delete-account">{t("account.yesDelete")}</button>
            <button className="btn line" onClick={() => setConfirmAccount(false)}>{t("account.keep")}</button>
          </Sheet>
        ))
      }
    >
      <TitleRow title={t("privacy.title")} back="/settings" />
      <div className="card" style={{ gap: 12 }}>
        <div className="lbl">{t("privacy.weKeep")}</div>
        {keep.map((s) => (
          <div className="row" key={s}><span className="ok"><Icon name="check" /></span><span className="p" style={{ fontSize: 17 }}>{s}</span></div>
        ))}
      </div>
      <div className="card" style={{ gap: 12 }}>
        <div className="lbl">{t("privacy.neverKeep")}</div>
        {never.map((s) => (
          <div className="row" key={s}><span className="no-icon"><Icon name="x" /></span><span className="p" style={{ fontSize: 17 }}>{s}</span></div>
        ))}
      </div>
      <p className="sm">{t("privacy.keepUntil")}</p>
      <p className="sm">{t("privacy.onlyTrusted", { helper })}</p>
      <div className="spacer" />
      <button className="btn line" onClick={() => setConfirm(true)}>{t("privacy.deleteHistory")}</button>
      <button className="btn redline" onClick={toggleWatching}>{watching ? t("privacy.turnOff") : t("privacy.turnOn")}</button>
      {data?.me.isDemo ? (
        <p className="sm center-text">{t("account.demo")}</p>
      ) : (
        <button className="ghost" style={{ alignSelf: "center" }} onClick={() => setConfirmAccount(true)} data-testid="delete-account">{t("account.delete")}</button>
      )}
    </Screen>
  );
}
