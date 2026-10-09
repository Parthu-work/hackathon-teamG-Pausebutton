import { desc } from "drizzle-orm";
import { aiAvailable } from "@/lib/check/ai";
import { AI_MODELS } from "@/lib/check/config";
import { SIGNAL_LABEL } from "@/lib/check/copy";
import { checkMessage } from "@/lib/check/pipeline";
import type { Verdict } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import testSet from "@/data/test-set.json";
import { HttpError } from "./session";

export type TestMode = "rules" | "haiku" | "sonnet";
export type TestOutcome = "caught" | "missed" | "genuine_ok" | "false_alarm";

export type TestResult = {
  id: number;
  family: string;
  label: "scam" | "genuine";
  text: string;
  verdict: Verdict;
  score: number;
  rulesScore: number;
  modelScore: number | null;
  outcome: TestOutcome;
  note: string;
  aiStatus: string;
  /** F7: the family our rules picked (drives the story shown) and the trick as Claude named it. */
  ourFamily?: string | null;
  aiScamType?: string | null;
};

export type TestSummary = {
  mode: TestMode;
  model: string;
  caught: number;
  missed: number;
  falseAlarms: number;
  genuineSuspicious: number;
  scams: number;
  genuine: number;
  degraded: number;
  answeredWithoutAi: number;
  rulesOnly: boolean;
  ms: number;
};

/** L1: runs the 40 team-written messages through the same check. */
export async function runTestSet(mode: TestMode): Promise<{ summary: TestSummary; results: TestResult[] }> {
  if (mode !== "rules" && !aiAvailable()) {
    throw new HttpError(400, "Set ANTHROPIC_API_KEY to run with Claude. The rules-only run works without it.");
  }
  const started = Date.now();
  const results: TestResult[] = [];
  const items = testSet as { id: number; family: string; label: "scam" | "genuine"; text: string }[];
  // A few at a time keeps an AI run quick without hitting rate limits.
  for (let i = 0; i < items.length; i += 4) {
    const batch = await Promise.all(
      items.slice(i, i + 4).map(async (t) => {
        const r = await checkMessage(t.text, {
          ai: mode === "rules" ? "off" : "auto",
          aiModel: mode === "sonnet" ? "sonnet" : "haiku",
          aiTimeoutMs: mode === "rules" ? undefined : 15_000,
        });
        const outcome: TestOutcome =
          t.label === "scam" ? (r.verdict === "SAFE" ? "missed" : "caught") : r.verdict === "SCAM" ? "false_alarm" : "genuine_ok";
        const why = r.hardRule
          ? `hard rule: ${r.hardRule.replace("_", " ")}`
          : [...new Set(r.signals.map((s) => SIGNAL_LABEL[s.type]))].join(", ") || (r.link ? `link ${r.link.status}` : "no signals");
        return {
          ...t,
          verdict: r.verdict,
          score: r.score,
          rulesScore: r.rulesScore,
          modelScore: r.modelScore,
          outcome,
          note: `${why} · rules ${r.rulesScore}% · model ${r.modelScore ?? "–"}%`,
          aiStatus: r.ai.status,
          ourFamily: r.family,
          aiScamType: r.ai.family ?? null,
        } satisfies TestResult;
      }),
    );
    results.push(...batch);
  }
  const summary: TestSummary = {
    mode,
    model: mode === "rules" ? "Rules + fast gate" : AI_MODELS[mode === "sonnet" ? "sonnet" : "haiku"],
    caught: results.filter((r) => r.outcome === "caught").length,
    missed: results.filter((r) => r.outcome === "missed").length,
    falseAlarms: results.filter((r) => r.outcome === "false_alarm").length,
    genuineSuspicious: results.filter((r) => r.label === "genuine" && r.verdict === "SUSPICIOUS").length,
    scams: results.filter((r) => r.label === "scam").length,
    genuine: results.filter((r) => r.label === "genuine").length,
    degraded: mode === "rules" ? 0 : results.filter((r) => r.aiStatus !== "ok" && r.aiStatus !== "not_needed").length,
    answeredWithoutAi: results.filter((r) => r.aiStatus === "not_needed").length,
    rulesOnly: mode === "rules",
    ms: Date.now() - started,
  };
  return { summary, results };
}

export async function saveRun(db: Db, run: { summary: TestSummary; results: TestResult[] }) {
  const [row] = await db.insert(schema.testRuns).values({ mode: run.summary.mode, summary: run.summary, results: run.results }).returning();
  return { id: row.id, createdAt: row.createdAt.toISOString(), ...run };
}

export async function latestRun(db: Db) {
  const row = await db.query.testRuns.findFirst({ orderBy: desc(schema.testRuns.createdAt) });
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    summary: row.summary as unknown as TestSummary,
    results: row.results as TestResult[],
  };
}
