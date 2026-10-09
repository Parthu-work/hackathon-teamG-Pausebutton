"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, LoadingScreen, Screen, Sheet, TitleRow, Toggle, useToast } from "@/components/ui";
import { api, post } from "@/lib/client/api";
import type { PersonView } from "@/lib/views";
import { useRao } from "./shell";

const RELATIONS = ["Son", "Daughter", "Spouse", "Friend"] as const;

function PersonCard({ p, onEdit, onRemove, showStatus }: { p: PersonView; onEdit: () => void; onRemove?: () => void; showStatus?: boolean }) {
  return (
    <div className="card row-card">
      <Avatar name={p.name} initials={p.name[0]?.toUpperCase()} />
      <div className="grow">
        <div style={{ fontWeight: 800, fontSize: 18 }}>{p.name} · {p.relation.toLowerCase()}</div>
        <p className="sm">{showStatus ? (p.status === "linked" ? "Joined" : "Not joined yet") : p.phone}</p>
      </div>
      {showStatus && <span className={`tag ${p.status === "linked" ? "g" : "a"}`}>{p.status === "linked" ? "LINKED" : "WAITING"}</span>}
      <button className="ib" aria-label={`Edit ${p.name}`} onClick={onEdit}><Icon name="edit" /></button>
      {onRemove && <button className="ib" aria-label={`Remove ${p.name}`} onClick={onRemove}><Icon name="trash" /></button>}
    </div>
  );
}

function useRemove(onDone?: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (p: PersonView) => api(`/api/me/people/${p.id}`, { method: "DELETE" }).then(() => p),
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      toast({ title: `${p.name} removed`, sub: "They will stop getting your alerts", icon: "trash" });
      onDone?.();
    },
  });
}

function RemoveSheet({ p, onCancel, onConfirm }: { p: PersonView; onCancel: () => void; onConfirm: () => void }) {
  const { data } = useRao();
  const lastLinked = p.status === "linked" && !data?.people.some((x) => x.id !== p.id && x.status === "linked");
  return (
    <Sheet onClose={onCancel}>
      <h2 className="h2">Remove {p.name}?</h2>
      <p className="p">They will stop getting your scam alerts. Your checked messages stay private.</p>
      {lastLinked && (
        <div className="card tint-red">
          <b style={{ fontSize: 17 }}>Nobody will be told</b>
          <p className="sm" style={{ color: "var(--text)" }}>{p.name} is the only person who gets your scam alerts. Add someone else soon.</p>
        </div>
      )}
      <button className="btn red" style={{ minHeight: 60 }} onClick={onConfirm}>Yes, remove {p.name}</button>
      <button className="btn line" onClick={onCancel}>Keep {p.name}</button>
    </Sheet>
  );
}

/** B1 · Your trusted people (step 1 of 3) */
export function SetupPeopleScreen() {
  const router = useRouter();
  const { data } = useRao();
  const [removing, setRemoving] = useState<PersonView | null>(null);
  const remove = useRemove(() => setRemoving(null));
  if (!data) return <LoadingScreen />;
  return (
    <Screen overlay={removing && <RemoveSheet p={removing} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)} />}>
      <div className="prog"><b className="on" /><b /><b /></div>
      <p className="lbl">Step 1 of 3</p>
      <h1 className="h1">Who should we tell when something looks wrong?</h1>
      <p className="p">Add one or more people you trust. Everyone you add gets the alert.</p>
      {data.people.map((p) => (
        <PersonCard key={p.id} p={p} onEdit={() => router.push(`/setup/person?id=${p.id}`)} onRemove={() => setRemoving(p)} />
      ))}
      <button className="btn line" onClick={() => router.push("/setup/person")}><Icon name="plus" />{data.people.length ? "Add another person" : "Add a person"}</button>
      <p className="sm">You can add or remove people any time in Settings.</p>
      <div className="spacer" />
      <button className={`btn ${data.people.length ? "amber" : "off"}`} disabled={!data.people.length} onClick={() => router.push("/setup/invites")}>
        Next: send invites
      </button>
    </Screen>
  );
}

/** B2 · Add or edit one person (remove lives here) */
export function PersonFormScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useRao();
  const editId = search.get("id");
  const back = search.get("from") === "settings" ? "/settings/people" : "/setup";
  const existing = data?.people.find((p) => p.id === editId);
  const [form, setForm] = useState<{ name: string; relation: string; phone: string; earlyHeadsUp: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const remove = useRemove(() => router.push(back));

  if (!data) return <LoadingScreen />;
  const f = form ?? {
    name: existing?.name ?? "",
    relation: existing?.relation ?? "Son",
    phone: existing?.phone ?? "",
    earlyHeadsUp: existing?.earlyHeadsUp ?? true,
  };
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  const who = f.name.trim() || "this person";

  async function save() {
    setError(null);
    try {
      if (existing) await api(`/api/me/people/${existing.id}`, { method: "PATCH", body: f });
      else await post("/api/me/people", f);
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      toast({ title: existing ? "Saved" : `${f.name} added`, sub: existing ? undefined : "Send them their invite code next", icon: "check" });
      router.push(back);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen overlay={removing && existing && <RemoveSheet p={existing} onCancel={() => setRemoving(false)} onConfirm={() => remove.mutate(existing)} />}>
      <TitleRow title={existing ? `Edit ${existing.name}` : "Add a person"} back={back} />
      <label>
        <div className="lbl">Name</div>
        <div className="in" style={{ marginTop: 6 }}><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Meera" /></div>
      </label>
      <div>
        <div className="lbl">Who is {who} to you?</div>
        <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
          {RELATIONS.map((r) => (
            <button key={r} className={`chip ${f.relation === r ? "on" : ""}`} onClick={() => set({ relation: r })}>{r}</button>
          ))}
        </div>
      </div>
      <label>
        <div className="lbl">Mobile number</div>
        <div className="in" style={{ marginTop: 6 }}><input inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" /></div>
      </label>
      <div className="card" style={{ gap: 14 }}>
        <div className="lbl">What {who} gets</div>
        <div className="row">
          <div className="grow"><b style={{ fontSize: 17 }}>Urgent scam alerts</b><p className="sm">Always on</p></div>
          <Toggle on label="Urgent scam alerts" onChange={() => {}} />
        </div>
        <div className="row">
          <div className="grow"><b style={{ fontSize: 17 }}>Early heads-up</b><p className="sm">For messages detected on your phone</p></div>
          <Toggle on={f.earlyHeadsUp} label="Early heads-up" onChange={(v) => set({ earlyHeadsUp: v })} />
        </div>
      </div>
      {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
      <div className="spacer" />
      <button className="btn amber" onClick={save}>Save person</button>
      {existing && <button className="btn redline" onClick={() => setRemoving(true)}><Icon name="trash" />Remove {existing.name}</button>}
    </Screen>
  );
}

/** B3 · Send a separate invite code to each person (step 2 of 3) */
export function InvitesScreen() {
  const router = useRouter();
  const toast = useToast();
  const { data } = useRao();
  if (!data) return <LoadingScreen />;
  const anyLinked = data.people.some((p) => p.status === "linked");
  const inviteText = (p: PersonView) =>
    `${data.me.name} added you as a trusted person on Pause Button (demo). Open the app, choose "I protect someone" and enter code ${p.inviteCode}. It works once and ends in 24 hours.`;

  async function copy(p: PersonView) {
    try {
      await navigator.clipboard.writeText(p.inviteCode);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
    toast({ title: "Invite code copied", sub: `Share it with ${p.name}`, icon: "check" });
  }

  async function share(list: PersonView[]) {
    const text = list.map(inviteText).join("\n\n");
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    }
  }

  const waiting = data.people.filter((p) => p.status === "waiting");
  return (
    <Screen>
      <div className="prog"><b className="on" /><b className="on" /><b /></div>
      <p className="lbl">Step 2 of 3</p>
      <h1 className="h1">Send each person their own code</h1>
      <p className="sm">Each code works once and ends in 24 hours.</p>
      {data.people.map((p) => (
        <div className="card" key={p.id} style={{ gap: 10 }}>
          <div className="row">
            <Avatar name={p.name} initials={p.name[0]?.toUpperCase()} size={40} />
            <b className="grow" style={{ fontSize: 18 }}>{p.name}</b>
            <span className={`tag ${p.status === "linked" ? "g" : "a"}`}>{p.status === "linked" ? "LINKED" : p.codeExpired ? "EXPIRED" : "WAITING"}</span>
          </div>
          <div className="mono center-text" style={{ fontSize: 30, opacity: p.status === "linked" ? 0.4 : 1 }}>{p.inviteCode}</div>
          {p.status === "linked" ? (
            <p className="sm center-text">{p.name} has joined.</p>
          ) : (
            <div className="row" style={{ gap: 10 }}>
              <button className="btn green sm-btn" onClick={() => share([p])}><Icon name="msg" />WhatsApp</button>
              <button className="btn line sm-btn" onClick={() => copy(p)}>Copy code</button>
            </div>
          )}
        </div>
      ))}
      {waiting.length > 1 && <button className="btn green" onClick={() => share(waiting)}><Icon name="msg" />Share every invite</button>}
      <div className="spacer" />
      <button className={`btn ${anyLinked ? "amber" : "off"}`} disabled={!anyLinked} onClick={() => router.push("/")}>Start checking messages</button>
      <p className="sm center-text">{anyLinked ? "You can add more people later in Settings." : "You can start once one person has joined."}</p>
    </Screen>
  );
}

/** B4 · Manage trusted people any time (Settings) · B5 confirm remove */
export function ManagePeopleScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useRao();
  if (!data) return <LoadingScreen />;
  const waiting = data.people.filter((p) => p.status === "waiting");

  async function resend(p: PersonView) {
    await post(`/api/me/people/${p.id}/resend`);
    await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
    toast({ title: `New code for ${p.name}`, sub: "Share it from the invites screen", icon: "check" });
    router.push("/setup/invites");
  }

  return (
    <Screen>
      <TitleRow title="Trusted people" back="/settings" />
      <p className="sm">Everyone here gets an alert when a message is a scam.</p>
      {data.people.map((p) => (
        <PersonCard key={p.id} p={p} showStatus onEdit={() => router.push(`/setup/person?id=${p.id}&from=settings`)} />
      ))}
      {waiting.map((p) => (
        <button key={p.id} className="btn line md-btn" onClick={() => resend(p)}>Resend {p.name}&apos;s code</button>
      ))}
      <button className="btn line" onClick={() => router.push("/setup/person?from=settings")}><Icon name="plus" />Add a person</button>
      <div className="spacer" />
      <p className="sm center-text">Settings › Trusted people</p>
    </Screen>
  );
}
