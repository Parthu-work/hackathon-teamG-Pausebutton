"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, Marks, ToastOutlet, ToastProvider, useToast } from "@/components/ui";
import { operatorApi, operatorRead } from "@/lib/client/api";
import type { CampaignsView, DisagreementsView, FamiliesView, ReportView } from "@/lib/views";

// Operator pages for phase 2: F3b campaigns, F4 disagreements, F7 families, F9b reported links.
// Every number comes from columns the app already writes; the synthetic demo households are labelled.

export function OpNav() {
  return (
    <nav className="row wrap" style={{ gap: 6 }}>
      <Link className="ghost" href="/tests">Test set</Link>
      <Link className="ghost" href="/campaigns">Campaigns</Link>
      <Link className="ghost" href="/reports">Reported links</Link>
      <Link className="ghost" href="/demo">Demo panel</Link>
      <Link className="ghost" href="/">Mr Rao&apos;s phone</Link>
      <Link className="ghost" href="/family">Family phone</Link>
    </nav>
  );
}

function OpHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="row wrap" style={{ alignItems: "flex-end" }}>
      <div className="grow">
        <h1 className="h1" style={{ fontSize: 34 }}>{title}</h1>
        <p className="sm" style={{ marginTop: 6 }}>{sub}</p>
      </div>
      <OpNav />
    </div>
  );
}

/** "Loading…", or why the data did not come (most often: the operator key). */
export function OpLoading({ error }: { error: Error | null }) {
  return (
    <div className="card">
      <p className="p">{error ? error.message : "Loading…"}</p>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ---------------- F3b · /campaigns ----------------

export function CampaignsPage() {
  const q = useQuery({ queryKey: ["ops-campaigns"], queryFn: () => operatorRead<CampaignsView>("/api/ops/campaigns"), refetchInterval: 5000 });
  const v = q.data;
  function exportCsv() {
    if (!v) return;
    const lines = [["fingerprint", "title", "family", "households", "last_24h", "first_seen", "last_seen"].join(",")];
    for (const r of v.rows) lines.push([r.fingerprint, JSON.stringify(r.title), r.family ?? "", r.households, r.last24h, r.firstSeenAt, r.lastSeenAt].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "campaigns.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="op">
      <div className="syn">SYNTHETIC DEMO DATA</div>
      <main className="op-main">
        <OpHeader title="Campaigns, last 24 hours" sub="Grouped by message fingerprint. No message text is stored. Route: /campaigns" />
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn line" onClick={exportCsv} disabled={!v}>Export</button>
          {v && <span className="sm">{v.synthetic.toLocaleString("en-IN")} synthetic sightings stand in for other households in this demo.</span>}
        </div>
        {!v ? (
          <OpLoading error={q.error} />
        ) : (
          <>
            <div className="grid-3">
              <div className="card"><div className="lbl">Active campaigns</div><div className="big-num">{v.active}</div><p className="sm">Seen by 2+ households</p></div>
              <div className="card">
                <div className="lbl">Fastest growing</div>
                <div className="big-num">{v.fastest?.last24h ?? 0}</div>
                <p className="sm">{v.fastest ? `“${v.fastest.title}” · +${v.fastest.last24h} today` : "Nothing spreading"}</p>
              </div>
              <div className="card"><div className="lbl">Households reached</div><div className="big-num">{v.householdsReached}</div><p className="sm">Across {v.active} campaign{v.active === 1 ? "" : "s"}</p></div>
            </div>
            <div className="card" style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Fingerprint</th><th>Family</th><th>Households</th><th>24h</th><th>First seen</th></tr></thead>
                <tbody>
                  {v.rows.map((r) => (
                    <tr key={r.fingerprint}>
                      <td className="mono" style={{ letterSpacing: 0, fontWeight: 600 }}>{r.fingerprint.slice(0, 4)}…{r.fingerprint.slice(-3)}</td>
                      <td><b>{r.title}</b>{r.family ? <span className="sm"> · {r.family}</span> : null}</td>
                      <td>{r.households}</td>
                      <td>{r.last24h ? `+${r.last24h}` : "–"}</td>
                      <td>{day(r.firstSeenAt)}</td>
                    </tr>
                  ))}
                  {!v.rows.length && <tr><td colSpan={5} className="sm">No fingerprint has been seen by two households yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card tint-green">
              <b style={{ fontSize: 17 }}>Zero new data collected</b>
              <p className="sm" style={{ color: "var(--text)" }}>Every number here comes from the fingerprint column the app already writes on each check. A sighting is the fingerprint and a household key, nothing else.</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------- F4 · /tests → Disagreements ----------------

export function DisagreementsPanel() {
  const q = useQuery({ queryKey: ["ops-disagreements"], queryFn: () => operatorRead<DisagreementsView>("/api/ops/disagreements") });
  const v = q.data;
  if (!v) return <OpLoading error={q.error} />;
  return (
    <>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <h2 className="h2" style={{ fontSize: 26 }}>Where families overrule us</h2>
          <p className="sm">Every check where the family&apos;s answer differed from ours, grouped by which stage decided. Last {v.days} days.</p>
        </div>
      </div>
      <div className="grid-3">
        <div className="card"><div className="lbl">Checks with a family answer</div><div className="big-num">{v.withAnswer}</div><p className="sm">Asked or alerted</p></div>
        <div className="card"><div className="lbl">We said scam, they approved</div><div className="big-num" style={{ color: v.scamApproved ? "var(--red-text)" : undefined }}>{v.scamApproved}</div><p className="sm">Money-level disagreement</p></div>
        <div className="card"><div className="lbl">We said safe, they said scam</div><div className="big-num" style={{ color: v.safeSaidScam ? "var(--red-text)" : undefined }}>{v.safeSaidScam}</div><p className="sm">The ones that would have cost money</p></div>
        <div className="card"><div className="lbl">Agreement</div><div className="big-num">{v.agreementPct === null ? "–" : `${v.agreementPct}%`}</div><p className="sm">{v.withAnswer - v.scamApproved - v.safeSaidScam} of {v.withAnswer}</p></div>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Decided by</th><th>Checks</th><th>Family agreed</th><th>Overruled</th><th>What it suggests</th></tr></thead>
          <tbody>
            {v.stages.map((s) => (
              <tr key={s.stage}>
                <td><b>{s.stage}</b></td><td>{s.checks}</td><td>{s.agreed}</td>
                <td style={{ color: s.overruled ? "var(--red-text)" : undefined, fontWeight: 800 }}>{s.overruled}</td>
                <td className="sm">{s.suggests}</td>
              </tr>
            ))}
            {!v.stages.length && <tr><td colSpan={5} className="sm">No family answers in the last {v.days} days. Run the demo: ask Arjun, or let him clear a scam.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>The {v.mostImportant.length || ""} that matter most</h2>
        <p className="sm">A family member approving a payment we called a scam is the strongest correction we can get: they overruled us with their own money on the line. Each one is listed with its signals, never its text.</p>
        {v.mostImportant.map((m) => (
          <div key={m.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="lbl">{m.stage} · cleared by {m.by} · {day(m.at)} {clockTime(m.at)}</div>
            <b>{m.title}</b>
            <Marks phrases={m.phrases} size={14} />
          </div>
        ))}
        {!v.mostImportant.length && <p className="sm">None. Nobody has approved something we called a scam.</p>}
      </div>
      <div className="card tint-green">
        <b style={{ fontSize: 17 }}>No new data collected</b>
        <p className="sm" style={{ color: "var(--text)" }}>Every column here already exists on the checks row: decidedBy, hardRule, score and familyVerdict.</p>
      </div>
    </>
  );
}

// ---------------- F7 · /tests → Families ----------------

const OUTCOME: Record<FamiliesView["rows"][number]["outcome"], { label: string; cls: string }> = {
  agree: { label: "Correct.", cls: "cg" },
  close: { label: "Close enough. Story still right.", cls: "co" },
  differ: { label: "Different story shown.", cls: "cm" },
  fallback: { label: "Generic fallback. We dropped the specific story.", cls: "cf" },
  no_ai: { label: "Claude did not read this one (fast path answered).", cls: "" },
};

export function FamiliesPanel() {
  const q = useQuery({ queryKey: ["ops-families"], queryFn: () => operatorRead<FamiliesView>("/api/ops/families") });
  const v = q.data;
  if (!v) return <OpLoading error={q.error} />;
  return (
    <>
      <div className="grow">
        <h2 className="h2" style={{ fontSize: 26 }}>Is the story we tell the right story?</h2>
        <p className="sm">The scam family picks every word of the explanation the user reads. This compares our regex family with the trick as Claude named it, on the last Claude run of the test set.</p>
      </div>
      <div className="grid-3">
        <div className="card"><div className="lbl">Our regex agrees with Claude</div><div className="big-num">{v.agree} / {v.compared}</div><p className="sm">{v.compared ? `${Math.round((v.agree / v.compared) * 1000) / 10}% of the messages Claude read` : "No Claude run yet"}</p></div>
        <div className="card"><div className="lbl">Different story shown</div><div className="big-num" style={{ color: v.differ ? "var(--red-text)" : undefined }}>{v.differ}</div><p className="sm">Right verdict, different explanation</p></div>
        <div className="card"><div className="lbl">Fell back to “pressure”</div><div className="big-num">{v.fallback}</div><p className="sm">The generic catch-all</p></div>
        <div className="card"><div className="lbl">Families in the enum</div><div className="big-num">{v.enumSize}</div><p className="sm">{v.unmatchedTestLabels.length} test labels have no match: {v.unmatchedTestLabels.join(", ")}</p></div>
      </div>
      {!v.run ? (
        <div className="card tint-amber">
          <b style={{ fontSize: 17 }}>Run the test set on Haiku or Sonnet first</b>
          <p className="sm" style={{ color: "var(--text)" }}>Claude names the trick on every message it reads. The rules-only run never asks it, so there is nothing to compare yet. Needs ANTHROPIC_API_KEY on the server.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <p className="sm">Last Claude run: {v.run.model} · {clockTime(v.run.createdAt)}</p>
          <table>
            <thead><tr><th>#</th><th>Message</th><th>Our regex said</th><th>Claude said</th><th>Shown to the user</th></tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="sm" style={{ maxWidth: 360 }}>{r.text.length > 110 ? r.text.slice(0, 110) + "…" : r.text}<br /><span className="tag">{r.testLabel}</span></td>
                  <td><code>{r.ours ?? "—"}</code></td>
                  <td>{r.claude ?? <span className="sm">—</span>}</td>
                  <td><b>{r.shown}</b><br /><span className={`sm ${OUTCOME[r.outcome].cls ? "" : ""}`}>{OUTCOME[r.outcome].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card tint-green">
        <b style={{ fontSize: 17 }}>Claude&apos;s name for the trick is now stored</b>
        <p className="sm" style={{ color: "var(--text)" }}>
          ai.ts asks for a scam_type, pipeline.ts carries it, and checks.ts now writes it to the ai_scam_type column: {v.storedOnChecks} real check{v.storedOnChecks === 1 ? "" : "s"} carry one so far.
        </p>
      </div>
    </>
  );
}

// ---------------- F9b · /reports ----------------

export function ReportsPage() {
  return (
    <ToastProvider>
      <ReportsInner />
      <ToastOutlet style={{ position: "fixed", left: "auto", right: 24, bottom: 24, width: 360 }} />
    </ToastProvider>
  );
}

const AUTO: Record<string, string> = { lookalike: "a", risky: "", unknown: "", official: "g", blocked: "a" };

function ReportsInner() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["ops-reports"], queryFn: () => operatorRead<{ waiting: number; rows: ReportView[]; officialCount: number }>("/api/ops/reports"), refetchInterval: 5000 });
  const review = useMutation({
    mutationFn: (v: { id: string; decision: "block" | "reject" | "unblock" }) => operatorApi<{ domain: string; status: string }>(`/api/ops/reports/${v.id}`, { body: { decision: v.decision } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["ops-reports"] });
      if (r.status === "unblocked") toast({ title: `${r.domain} is no longer blocked`, sub: "Off the live blocklist, no redeploy", icon: "x" });
      else toast({ title: r.status === "blocked" ? `${r.domain} is now blocked` : `${r.domain} left open`, sub: r.status === "blocked" ? "Live for every family, no redeploy" : "Reports of it are closed", icon: r.status === "blocked" ? "shield" : "x" });
    },
    onError: (e) => toast({ title: "Not changed", sub: e.message, icon: "warn", tone: "red" }),
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const v = q.data;
  return (
    <div className="op">
      <div className="syn">SYNTHETIC DEMO DATA</div>
      <main className="op-main">
        <OpHeader title="Reported links" sub="Family reports waiting for review. Approving adds the domain to the live blocklist with no redeploy. Route: /reports" />
        {!v ? (
          <OpLoading error={q.error} />
        ) : (
          <>
            <div className="row"><span className="pill medium amber">{v.waiting} WAITING</span></div>
            <div className="card" style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Domain</th><th>Reported by</th><th>Seen in</th><th>Auto-check</th><th></th></tr></thead>
                <tbody>
                  {v.rows.map((r) => (
                    <tr key={r.id} data-testid={`report-${r.domain}`}>
                      <td><b style={{ wordBreak: "break-all" }}>{r.domain}</b></td>
                      <td>{r.reportedBy || "Deleted account"}{r.otherReporters ? <span className="sm"> · {r.otherReporters} more</span> : null}</td>
                      <td>{r.seenIn} check{r.seenIn === 1 ? "" : "s"}</td>
                      <td><span className={`tag ${AUTO[r.autoCheck] ?? ""}`}>{r.autoReason.toUpperCase()}</span></td>
                      <td>
                        {r.protectedSite ? (
                          <span className="sm" style={{ fontWeight: 800 }}>Cannot block</span>
                        ) : r.status === "pending" ? (
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn red" disabled={review.isPending && busyId === r.id} onClick={() => { setBusyId(r.id); review.mutate({ id: r.id, decision: "block" }); }}>Block</button>
                            <button className="btn line" disabled={review.isPending && busyId === r.id} onClick={() => { setBusyId(r.id); review.mutate({ id: r.id, decision: "reject" }); }}>Reject</button>
                          </div>
                        ) : r.status === "blocked" ? (
                          <div className="row" style={{ gap: 6 }}>
                            <span className="pill small red">BLOCKED</span>
                            <button className="btn line" disabled={review.isPending && busyId === r.id} onClick={() => { setBusyId(r.id); review.mutate({ id: r.id, decision: "unblock" }); }}>Unblock</button>
                          </div>
                        ) : (
                          <span className="pill small ink">{r.status.toUpperCase()}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!v.rows.length && <tr><td colSpan={5} className="sm">No reports yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid-3">
              <div className="card tint-green">
                <div className="row"><Icon name="shieldCheck" /><b style={{ fontSize: 17 }}>Real banks can never be blocked</b></div>
                <p className="sm" style={{ color: "var(--text)" }}>The {v.officialCount} official domains in links.ts are a permanent allowlist. A report against one is refused before a human ever sees it.</p>
              </div>
              <div className="card">
                <b style={{ fontSize: 17 }}>The blocklist is a table now</b>
                <p className="sm">blocklist.json is still imported at build time. Blocked reports join it from the reported_domains table on every check, so adding one needs no commit and no deploy.</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
