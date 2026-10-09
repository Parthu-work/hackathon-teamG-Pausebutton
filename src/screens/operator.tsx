"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { clockTime, ToastOutlet, ToastProvider, useToast, VerdictPill } from "@/components/ui";
import { api, broadcastWifiDrop, post } from "@/lib/client/api";
import type { TestResult, TestSummary } from "@/lib/server/testset";
import type { EventView } from "@/lib/views";

type Latest = {
  run: { id: string; createdAt: string; summary: TestSummary; results: TestResult[] } | null;
  aiAvailable: boolean;
  gate: { loaded: boolean; createdAt?: string; rows?: number };
};

const SQ: Record<TestResult["outcome"], { cls: string; mark: string }> = {
  caught: { cls: "cg", mark: "✓" },
  missed: { cls: "cm", mark: "✕" },
  genuine_ok: { cls: "co", mark: "✓" },
  false_alarm: { cls: "cf", mark: "!" },
};

function OpHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="row wrap" style={{ alignItems: "flex-end" }}>
      <div className="grow">
        <h1 className="h1" style={{ fontSize: 34 }}>{title}</h1>
        <p className="sm" style={{ marginTop: 6 }}>{sub}</p>
      </div>
      <nav className="row" style={{ gap: 6 }}>
        <Link className="ghost" href="/tests">Test set</Link>
        <Link className="ghost" href="/demo">Demo panel</Link>
        <Link className="ghost" href="/">Mr Rao&apos;s phone</Link>
        <Link className="ghost" href="/family">Arjun&apos;s phone</Link>
      </nav>
    </div>
  );
}

/** L1 · Operator: test set page (/tests) */
export function TestsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["tests-latest"], queryFn: () => api<Latest>("/api/tests/latest") });
  const run = useMutation({
    mutationFn: (mode: "rules" | "haiku" | "sonnet") => post("/api/tests/run", { mode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tests-latest"] }),
  });
  const r = q.data?.run;
  const s = r?.summary;
  const scams = r?.results.filter((x) => x.label === "scam") ?? [];
  const genuine = r?.results.filter((x) => x.label === "genuine") ?? [];
  const missed = r?.results.filter((x) => x.outcome === "missed") ?? [];
  const falseAlarms = r?.results.filter((x) => x.outcome === "false_alarm") ?? [];

  return (
    <div className="op">
      <div className="syn">SYNTHETIC DEMO DATA</div>
      <main className="op-main">
        <OpHeader
          title="Test set: 40 messages"
          sub="20 scam and 20 genuine, written by the team. Every message goes through the same check as the app. The page lists the misses. Route: /tests"
        />
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn ink" disabled={run.isPending} onClick={() => run.mutate("rules")}>Run rules + model (no AI)</button>
          <button className="btn amber" disabled={run.isPending || !q.data?.aiAvailable} onClick={() => run.mutate("haiku")}>Run on Haiku (fast)</button>
          <button className="btn line" disabled={run.isPending || !q.data?.aiAvailable} onClick={() => run.mutate("sonnet")}>Run on Sonnet (final)</button>
          {run.isPending && <span className="sm">Running…</span>}
        </div>
        {q.data && !q.data.aiAvailable && (
          <p className="sm">Claude runs are off: set <code>ANTHROPIC_API_KEY</code> on the server to enable them. Fast-gate model: {q.data.gate.loaded ? `loaded (${q.data.gate.rows} training rows)` : "missing, run pnpm ml:all"}.</p>
        )}
        {run.isError && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{run.error.message}</p>}

        {!s ? (
          <div className="card"><p className="p">No run yet. Start with “Run rules + model”.</p></div>
        ) : (
          <>
            <div className="grid-3">
              <div className="card"><div className="lbl">Scams caught</div><div className="big-num">{s.caught}</div><p className="sm">of {s.scams} · called SCAM or SUSPICIOUS</p></div>
              <div className="card"><div className="lbl">Scams missed</div><div className="big-num" style={{ color: s.missed ? "var(--red-text)" : undefined }}>{s.missed}</div><p className="sm">Called SAFE. Listed below, verbatim.</p></div>
              <div className="card"><div className="lbl">Genuine flagged</div><div className="big-num" style={{ color: s.falseAlarms ? "var(--red-text)" : undefined }}>{s.falseAlarms}</div><p className="sm">of {s.genuine} · genuine messages called SCAM ({s.genuineSuspicious} only SUSPICIOUS)</p></div>
              <div className="card">
                <div className="lbl">Last run</div>
                <b style={{ fontSize: 18 }}>{s.model} · {clockTime(r.createdAt)}</b>
                <p className="sm">Degraded calls: {s.degraded} · Rules only: {s.rulesOnly ? "on" : "off"}</p>
                <p className="sm">Answered without Claude: {s.answeredWithoutAi} of 40 · {(s.ms / 1000).toFixed(1)} s</p>
              </div>
            </div>

            <div className="card" style={{ gap: 12 }}>
              <div className="row wrap" style={{ gap: 18 }}>
                <h2 className="h2 grow" style={{ fontSize: 22 }}>All 40 messages</h2>
                <span className="leg"><span className="sq cg">✓</span>Scam caught</span>
                <span className="leg"><span className="sq cm">✕</span>Scam missed</span>
                <span className="leg"><span className="sq co">✓</span>Genuine OK</span>
                <span className="leg"><span className="sq cf">!</span>False alarm</span>
              </div>
              {[["Scam messages (1 to 20)", scams], ["Genuine messages (21 to 40)", genuine]].map(([label, list]) => (
                <div key={label as string} className="col">
                  <div className="lbl">{label as string}</div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {(list as TestResult[]).map((x) => (
                      <span key={x.id} className={`sq ${SQ[x.outcome].cls}`} title={`${x.family}: ${x.verdict}`}>
                        <b>{x.id}</b>{SQ[x.outcome].mark}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {[["Missed scams, verbatim", missed], ["Genuine messages flagged as SCAM", falseAlarms]].map(([label, list]) => (
              <div key={label as string} className="card">
                <h2 className="h2" style={{ fontSize: 20 }}>{label as string}</h2>
                {(list as TestResult[]).length === 0 ? (
                  <p className="sm">None in this run.</p>
                ) : (
                  (list as TestResult[]).map((x) => (
                    <div key={x.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      <div className="lbl">#{x.id} · {x.family}</div>
                      <p className="p" style={{ fontSize: 16 }}>{x.text}</p>
                    </div>
                  ))
                )}
              </div>
            ))}

            <div className="card" style={{ overflowX: "auto" }}>
              <h2 className="h2" style={{ fontSize: 20 }}>Message by message</h2>
              <table>
                <thead><tr><th>#</th><th>Family</th><th>Label</th><th>Predicted</th><th>Score</th><th>Result</th><th>Note</th></tr></thead>
                <tbody>
                  {r.results.map((x) => (
                    <tr key={x.id}>
                      <td>{x.id}</td><td>{x.family}</td><td>{x.label}</td>
                      <td><VerdictPill verdict={x.verdict} size="small" icon={false} /></td>
                      <td>{x.score}%</td>
                      <td><span className={`sq ${SQ[x.outcome].cls}`} style={{ width: 26, height: 26, fontSize: 13 }}>{SQ[x.outcome].mark}</span></td>
                      <td className="sm">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** L2 · Operator: two-phone demo panel (/demo) */
export function DemoPage() {
  return (
    <ToastProvider>
      <DemoPanel />
      <ToastOutlet style={{ position: "fixed", left: "auto", right: 24, bottom: 24, width: 360 }} />
    </ToastProvider>
  );
}

function DemoPanel() {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<EventView[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [frameKey, setFrameKey] = useState(0);
  const since = useRef(0);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void post("/api/demo/personas").then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ events: EventView[] }>(`/api/demo/events?since=${since.current}`);
        if (stop) return;
        if (r.events.length) {
          since.current = r.events[r.events.length - 1].id;
          setEvents((list) => [...list, ...r.events].slice(-120));
        }
        setLastSync(Date.now());
      } catch {
        /* offline: shown by the sync line */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    const c = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(c);
    };
  }, [ready]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  async function reset() {
    await post("/api/demo/reset");
    since.current = 0;
    setEvents([]);
    setFrameKey((k) => k + 1);
    toast({ title: "Demo data reset", sub: "Holds and checks cleared · Arjun still linked" });
  }
  async function sample() {
    await post("/api/demo/sample");
    toast({ title: "Scam sample sent", sub: "It arrives on Mr Rao's phone", icon: "msg" });
  }
  function wifi() {
    broadcastWifiDrop(8000);
    toast({ title: "Wi-Fi dropped for 8 seconds", sub: "Both phones lose the service", icon: "wifi", tone: "red" });
  }

  const ago = lastSync ? (Math.max(0, now - lastSync) / 1000).toFixed(1) : "–";
  return (
    <div className="op" style={{ background: "var(--bg2)" }}>
      <div className="syn">SYNTHETIC DEMO DATA</div>
      <main className="op-main" style={{ maxWidth: 1320 }}>
        <OpHeader
          title="Demo panel: two phones, one service"
          sub="Route /demo. Use it when the second physical phone does not buzz. Both screens poll the same service every 2 seconds."
        />
        <p className="sm" style={{ fontWeight: 700 }}>
          <span className="dot" style={{ display: "inline-block", background: lastSync && now - lastSync < 5000 ? "#2E7D5B" : "#C6372B", marginRight: 8 }} />
          {lastSync && now - lastSync < 5000 ? "Online" : "Offline"} · polling every 2 s · last sync {ago} s ago
        </p>
        {ready && (
          <div className="demo-grid">
            <div className="col">
              <div className="lbl">Mr Rao · route /</div>
              <iframe key={`rao-${frameKey}`} title="Mr Rao's phone" src="/" />
            </div>
            <div className="col" style={{ gap: 16 }}>
              <div className="card" style={{ gap: 10 }}>
                <div className="lbl">Controls</div>
                <button className="btn red" onClick={reset}>Reset demo data</button>
                <button className="btn amber" onClick={sample}>Run a scam sample</button>
                <button className="btn line" onClick={wifi}><Icon name="wifi" />Simulate Wi-Fi drop</button>
                <p className="sm">Reset clears holds and checks and keeps Arjun linked. The sample is the CBI call, arriving by WhatsApp. For the full story, paste the CBI example on Mr Rao&apos;s phone. Tap Arjun&apos;s phone once first so it is allowed to play sound.</p>
              </div>
              <div className="card" style={{ gap: 10, maxHeight: 560, overflowY: "auto" }}>
                <div className="lbl">Event log (live)</div>
                {events.length === 0 ? (
                  <p className="sm">Nothing yet. Check a message on Mr Rao&apos;s phone.</p>
                ) : (
                  <div className="log">
                    {events.flatMap((e) => [
                      <span key={`t${e.id}`}>{new Date(e.createdAt).toLocaleTimeString("en-GB")}</span>,
                      <span key={`m${e.id}`}>{e.message}</span>,
                    ])}
                  </div>
                )}
                <div ref={logEnd} />
              </div>
            </div>
            <div className="col">
              <div className="lbl">Arjun · route /family</div>
              <iframe key={`arjun-${frameKey}`} title="Arjun's phone" src="/family" allow="autoplay" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
