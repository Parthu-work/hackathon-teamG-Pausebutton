"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, dayTime, Marks, RaoTabs, Screen, Sheet, TitleRow, useToast, VerdictPill } from "@/components/ui";
import type { Verdict } from "@/lib/check/types";
import { api, post } from "@/lib/client/api";
import { useRao } from "./shell";

type CheckRow = { id: string; title: string; verdict: Verdict; checkedBy: string | null; createdAt: string; phrases: string[]; source: string };

/** K1 · My checks · Q1 empty · Q2 loading */
export function HistoryScreen() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["checks"], queryFn: () => api<CheckRow[]>("/api/me/checks"), refetchInterval: 5000 });

  if (q.isPending) {
    return (
      <Screen tabs={<RaoTabs active="checks" />}>
        <div className="row"><span className="pm"><i /><i /></span><b className="grow display" style={{ fontSize: 20 }}>My checks</b></div>
        <div className="in" style={{ gap: 10, minHeight: 52, color: "var(--muted)" }}><Icon name="search" />Search checks</div>
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

  const rows = q.data ?? [];
  if (!rows.length) {
    return (
      <Screen tabs={<RaoTabs active="checks" />}>
        <div className="row"><span className="pm"><i /><i /></span><b className="grow display" style={{ fontSize: 20 }}>My checks</b></div>
        <div style={{ display: "flex", justifyContent: "center", margin: "18px 0 6px" }}>
          <span className="circle" style={{ width: 120, height: 120, background: "var(--amber-tint)", boxShadow: "0 0 0 14px rgba(242,169,0,.10)" }}>
            <span className="pm" style={{ gap: 8 }}><i style={{ width: 14, height: 48, borderRadius: 5 }} /><i style={{ width: 14, height: 48, borderRadius: 5 }} /></span>
          </span>
        </div>
        <h1 className="h1 center-text">No checks yet</h1>
        <p className="p center-text" style={{ color: "var(--muted)" }}>Messages you check will show up here. We keep the verdict and the warning phrases.</p>
        <div className="spacer" />
        <button className="btn amber" onClick={() => router.push("/")}>Check a message</button>
      </Screen>
    );
  }

  return (
    <Screen tabs={<RaoTabs active="checks" />}>
      <h1 className="h1">My checks</h1>
      {rows.map((r) => (
        <Link key={r.id} href={`/check/${r.id}`} className="card" style={{ textDecoration: "none" }}>
          <div className="row"><VerdictPill verdict={r.verdict} size="small" icon={false} /><span className="grow" /><span className="sm">{dayTime(r.createdAt)}</span></div>
          <b style={{ fontSize: 17 }}>{r.title}</b>
          {r.checkedBy && (
            <p className="sm" style={{ color: "var(--text)", fontWeight: 700 }}>
              Checked by {r.checkedBy}: {r.verdict === "SAFE" ? "not a scam" : "a scam"}
            </p>
          )}
          {r.phrases.length ? <Marks phrases={r.phrases} size={15} /> : r.verdict === "SAFE" && !r.checkedBy && <p className="sm">No warning signs found.</p>}
        </Link>
      ))}
      <div className="spacer" />
      <p className="sm center-text">We keep the warning phrases. Scam and suspicious messages are shared with your family for 24 hours. Tap a check to see why.</p>
    </Screen>
  );
}

/** K2 · Settings */
export function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useRao();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/me/settings", { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rao-state"] }),
  });
  if (!data) return null;
  const first = data.people.find((p) => p.status === "linked") ?? data.people[0];
  const watching = data.me.watchSms || data.me.watchWhatsapp;

  async function signOut() {
    await post("/api/auth/sign-out", { app: "rao" });
    queryClient.clear();
    router.push("/welcome");
  }

  return (
    <Screen tabs={<RaoTabs active="settings" />}>
      <h1 className="h1">Settings</h1>
      <div className="card row-card">
        {first ? <Avatar name={first.name} size={44} /> : <span className="circle" style={{ width: 44, height: 44, background: "var(--chip)" }}><Icon name="people" /></span>}
        <div className="grow">
          <b style={{ fontSize: 17 }}>{first ? `${first.name} · ${first.relation.toLowerCase()}` : "No trusted person yet"}</b>
          <p className="sm">{data.people.length > 1 ? `Your trusted people (${data.people.length})` : "Your trusted person"}</p>
        </div>
        <button className="ghost" onClick={() => router.push("/settings/people")}>Change</button>
      </div>
      <div className="card">
        <div className="lbl">Text size</div>
        <div className="row" style={{ gap: 8 }}>
          {(["A", "A+", "A++"] as const).map((s, i) => (
            <button key={s} className={`chip ${data.me.textSize === s ? "on" : ""}`} style={{ fontSize: 16 + i * 4 }} onClick={() => save.mutate({ textSize: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row"><div className="lbl grow">Language</div><span className="tag">PHASE 2</span></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="chip on">English</button>
          {["हिन्दी", "తెలుగు"].map((l) => (
            <button key={l} className="chip" onClick={() => toast({ title: "Coming in phase 2", sub: "Hindi and Telugu use the same screens", icon: "info" })}>{l}</button>
          ))}
        </div>
      </div>
      <Link href="/watch" className="card row-card" style={{ textDecoration: "none" }}>
        <div className="grow">
          <b style={{ fontSize: 17 }}>Watch my messages</b>
          <p className="sm">Warn me when a message arrives. Needs the Android app.</p>
        </div>
        <span className={`tag ${watching ? "g" : ""}`}>{watching ? "ON" : "OFF"}</span>
        <Icon name="chev" />
      </Link>
      <Link href="/privacy" className="card row-card" style={{ textDecoration: "none" }}>
        <div className="grow"><b style={{ fontSize: 17 }}>What we keep</b><p className="sm">Privacy and your data</p></div>
        <Icon name="chev" />
      </Link>
      <div className="spacer" />
      <button className="ghost" style={{ alignSelf: "center" }} onClick={signOut}>Sign out</button>
    </Screen>
  );
}

/** P3 · What we keep (privacy) */
export function PrivacyScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useRao();
  const [confirm, setConfirm] = useState(false);
  const helper = data?.helperNames[0] ?? "family";
  const watching = !!data && (data.me.watchSms || data.me.watchWhatsapp);

  async function deleteHistory() {
    await api("/api/me/checks", { method: "DELETE" });
    setConfirm(false);
    await queryClient.invalidateQueries();
    toast({ title: "History deleted", sub: "Your checks are gone from this app", icon: "trash" });
  }

  async function toggleWatching() {
    await api("/api/me/settings", { method: "PATCH", body: { watchSms: !watching, watchWhatsapp: !watching } });
    await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
    toast({ title: watching ? "Watching is off" : "Watching is on", sub: watching ? "New messages are not checked" : "New messages are checked", icon: "eye" });
  }

  const keep = [
    "A short fingerprint of each message",
    "The verdict and the warning phrases",
    `The text of a scam or suspicious message, for 24 hours, so ${helper} can read exactly what you got`,
    `Payment holds and ${helper}'s decision`,
  ];
  const never = ["The text of safe messages", "Your contacts or old chats", "Your bank details"];
  return (
    <Screen
      overlay={
        confirm && (
          <Sheet onClose={() => setConfirm(false)}>
            <h2 className="h2">Delete your history?</h2>
            <p className="p">All your checks and their warning phrases are removed. Payment holds go too.</p>
            <button className="btn red" onClick={deleteHistory}>Yes, delete</button>
            <button className="btn line" onClick={() => setConfirm(false)}>Keep it</button>
          </Sheet>
        )
      }
    >
      <TitleRow title="What we keep" back="/settings" />
      <div className="card" style={{ gap: 12 }}>
        <div className="lbl">We keep</div>
        {keep.map((t) => (
          <div className="row" key={t}><span className="ok"><Icon name="check" /></span><span className="p" style={{ fontSize: 17 }}>{t}</span></div>
        ))}
      </div>
      <div className="card" style={{ gap: 12 }}>
        <div className="lbl">We never keep</div>
        {never.map((t) => (
          <div className="row" key={t}><span className="no-icon"><Icon name="x" /></span><span className="p" style={{ fontSize: 17 }}>{t}</span></div>
        ))}
      </div>
      <p className="sm">
        Only the trusted people who are alerted or asked about a message can read its text. In this demo every message is made up: please do not
        type real messages. Messages that need a closer look are also read by Claude (Anthropic).
      </p>
      <div className="spacer" />
      <button className="btn line" onClick={() => setConfirm(true)}>Delete my history</button>
      <button className="btn redline" onClick={toggleWatching}>{watching ? "Turn off watching" : "Turn on watching"}</button>
    </Screen>
  );
}
