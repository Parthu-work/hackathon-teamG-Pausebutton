"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { clockTime, Screen, TitleRow, useToast, VerdictPill } from "@/components/ui";
import { api, post } from "@/lib/client/api";
import type { SimMessageView } from "@/lib/views";

/** P1 · Simulated inbox (demo mode, any phone) */
export function InboxScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["inbox"], queryFn: () => api<SimMessageView[]>("/api/me/inbox"), refetchInterval: 2000 });
  const receive = useMutation({
    mutationFn: () => post("/api/me/inbox"),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => toast({ title: "Could not deliver", sub: e.message, icon: "warn", tone: "red" }),
  });

  function open(m: SimMessageView) {
    if (m.checkId) router.push(`/check/${m.checkId}`);
    else toast({ title: m.fromContact ? "Not checked" : "Not watched", sub: m.fromContact ? "Messages from saved contacts are not checked." : "Watching is off for this app.", icon: "info" });
  }

  return (
    <Screen sim>
      <TitleRow title="Messages (demo)" back="/" />
      {(q.data ?? []).map((m) => (
        <button key={m.id} className="card" onClick={() => open(m)}>
          <div className="row">
            <span className="src"><Icon name="msg" /></span>
            <div className="grow">
              <b style={{ fontSize: 16 }}>{m.sender}</b>
              <p className="sm" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.text}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span className="sm">{clockTime(m.createdAt)}</span>
              {m.verdict === "SKIPPED" || m.verdict === null ? (
                <span className="tag">{m.verdict ?? "NOT WATCHED"}</span>
              ) : (
                <VerdictPill verdict={m.verdict} size="small" icon={false} />
              )}
            </div>
          </div>
        </button>
      ))}
      <p className="sm">Messages from saved contacts are not checked.</p>
      <div className="spacer" />
      <button className="btn amber" disabled={receive.isPending} onClick={() => receive.mutate()}>
        {receive.isPending ? "Delivering…" : "Receive a test scam message"}
      </button>
      <p className="sm center-text">Demo only. A pilot on Android reads real notifications, with consent.</p>
    </Screen>
  );
}
