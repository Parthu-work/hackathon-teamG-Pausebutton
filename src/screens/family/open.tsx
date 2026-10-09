"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Screen } from "@/components/ui";
import { ApiError, post } from "@/lib/client/api";
import { stashPendingOpen } from "@/lib/client/pending-open";
import { closeNotifications } from "@/lib/client/push";

type Destination = { id: string; kind: "urgent" | "headsup" | "ask"; checkId: string; holdId: string | null; handled: boolean; url: string };

/**
 * A tap on a push notification lands here (/open/<alertId>) and goes straight
 * on to the paused payment or the message, never the home screen, whether the
 * app was open, in the background or closed. Signed out: the destination is
 * kept through sign-in. Unreachable: it says so and offers to try again.
 */
export function OpenAlertScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    post<Destination>(`/api/family/alerts/${id}/open`)
      .then((d) => {
        if (cancelled) return;
        void closeNotifications((tag) => tag === `alert-${id}`);
        router.replace(d.url);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 401) {
          stashPendingOpen(`/open/${id}`);
          router.replace("/welcome");
        } else if (status === 0) {
          setUnreachable(true);
        } else {
          router.replace("/family"); // not this person's alert, or it is gone
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, router, attempt]);

  if (unreachable) {
    return (
      <Screen tone="amber-tint">
        <div className="note" data-testid="open-unreachable"><Icon name="wifi" />Reconnecting…</div>
        <div className="card tint-red" style={{ gap: 6 }}>
          <div className="row"><Icon name="wifi" /><b style={{ fontSize: 19 }}>We cannot reach the app</b></div>
          <p className="sm" style={{ color: "var(--text)" }}>Your internet dropped. The alert is still waiting for you; a paused payment stays paused.</p>
        </div>
        <button
          className="btn amber"
          onClick={() => {
            setUnreachable(false);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
        <button className="btn line" onClick={() => router.replace("/family")}>Open the app</button>
      </Screen>
    );
  }
  return (
    <Screen center bodyStyle={{ justifyContent: "center", gap: 14 }}>
      <span className="circle" style={{ width: 72, height: 72, background: "var(--chip)" }}><Icon name="bell" size={36} /></span>
      <b className="display" style={{ fontSize: 22 }} data-testid="opening-alert">Opening the alert…</b>
    </Screen>
  );
}
