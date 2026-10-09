import { and, gte, isNotNull } from "drizzle-orm";
import { keyPhrases } from "@/lib/check/phrases";
import type { ScamFamily } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import testSet from "@/data/test-set.json";
import type { DisagreementsView, FamiliesView, FamilyRow } from "@/lib/views";
import { TITLES } from "./checks";
import { userNames } from "./holds";
import { latestRun } from "./testset";

// Operator reports that read columns the app already writes:
//  F4 · where families overruled the check (decidedBy, hardRule, familyVerdict)
//  F7 · whether the scam family we explain is the one Claude saw (aiScamType)

type Check = typeof schema.checks.$inferSelect;

const HARD: Record<string, string> = {
  secrecy_payment: "Hard rule · secrecy + payment",
  credential_request: "Hard rule · code or app request",
  bad_link: "Hard rule · look-alike or blocked link",
  live_call: "Hard rule · live-call guard",
};

/** The stage that decided a check, in the report's words. */
export function stageOf(c: Pick<Check, "hardRule" | "decidedBy" | "verdict">) {
  if (c.hardRule) return HARD[c.hardRule] ?? `Hard rule · ${c.hardRule}`;
  if (c.decidedBy === "ai") return "Claude · raised from suspicious";
  if (c.verdict === "SCAM") return "Score · 70%+ band";
  if (c.verdict === "SUSPICIOUS") return "Score · 30–69% band";
  return "Score · below 30% (safe)";
}

/** Overruled = money-level disagreement: we said SCAM and they approved, or we said SAFE and they said scam. */
function overruled(c: Pick<Check, "verdict" | "familyVerdict">) {
  return (c.verdict === "SCAM" && c.familyVerdict === "not_scam") || (c.verdict === "SAFE" && c.familyVerdict === "scam");
}

function suggestion(stage: string, overruled: number, checks: number) {
  if (!checks) return "No checks yet.";
  if (overruled === 0) return stage.startsWith("Hard rule") ? "The floor is holding. Do not touch it." : "No disagreement here.";
  if (stage.includes("link")) return `${overruled} overruled: check whether these were real sites we do not list yet.`;
  if (stage.startsWith("Claude")) return `${overruled} overruled: raising on these signals may be too eager.`;
  if (stage.startsWith("Score · 70")) return `${overruled} overruled: genuine messages scored into the scam band.`;
  if (stage.includes("safe")) return `${overruled} missed: the family saw a scam we called safe.`;
  return `${overruled} overruled: read their signals below.`;
}

export async function disagreementsView(db: Db, days = 30): Promise<DisagreementsView> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.query.checks.findMany({ where: and(isNotNull(schema.checks.familyVerdict), gte(schema.checks.createdAt, since)) });
  const stages = new Map<string, { checks: number; overruled: number }>();
  for (const c of rows) {
    const s = stageOf(c);
    const cur = stages.get(s) ?? { checks: 0, overruled: 0 };
    cur.checks += 1;
    if (overruled(c)) cur.overruled += 1;
    stages.set(s, cur);
  }
  const scamApproved = rows.filter((c) => c.verdict === "SCAM" && c.familyVerdict === "not_scam");
  const names = await userNames(db, scamApproved.map((c) => c.familyVerdictBy ?? ""));
  const over = rows.filter(overruled).length;
  return {
    days,
    withAnswer: rows.length,
    scamApproved: scamApproved.length,
    safeSaidScam: rows.filter((c) => c.verdict === "SAFE" && c.familyVerdict === "scam").length,
    agreementPct: rows.length ? Math.round(((rows.length - over) / rows.length) * 1000) / 10 : null,
    stages: [...stages].map(([stage, v]) => ({ stage, checks: v.checks, agreed: v.checks - v.overruled, overruled: v.overruled, suggests: suggestion(stage, v.overruled, v.checks) })).sort((a, b) => b.checks - a.checks),
    mostImportant: scamApproved.map((c) => ({
      id: c.id,
      title: c.title,
      stage: stageOf(c),
      phrases: keyPhrases(c.signals, c.link, c.hardPhrases, 4),
      by: c.familyVerdictBy ? names[c.familyVerdictBy] ?? "Family" : "Family",
      at: (c.familyVerdictAt ?? c.createdAt).toISOString(),
    })),
  };
}

// ---------- F7 · the scam family ----------

const ENUM: ScamFamily[] = [
  "fake_officer", "bank_kyc", "courier_fee", "lottery", "task_job", "wrong_upi_refund", "qr_receive", "power_cut",
  "relative_emergency", "investment", "loan_fee", "sim_block", "tax_refund", "remote_access", "otp_request", "pressure",
];

/** Claude names the trick in free words; this maps the words onto our enum. */
const WORDS: [ScamFamily, RegExp][] = [
  ["remote_access", /anydesk|remote|screen.?shar|teamviewer/i],
  ["qr_receive", /\bqr\b|upi pin/i],
  ["wrong_upi_refund", /mistake|wrong(?:ly)?|refund|sent by/i],
  ["fake_officer", /officer|police|cbi|arrest|digital|narcotic|court|custom(?!er)|customs/i],
  ["bank_kyc", /kyc|bank|pan |account block/i],
  ["courier_fee", /courier|parcel|deliver|shipment|post/i],
  ["lottery", /lottery|prize|lucky|won|kbc|jackpot/i],
  ["task_job", /task|job|part.?time|telegram|commission|work from home/i],
  ["investment", /invest|stock|trading|returns|ipo|crypto/i],
  ["loan_fee", /loan/i],
  ["power_cut", /electric|power|bill/i],
  ["sim_block", /\bsim\b|trai|telecom|mobile number/i],
  ["tax_refund", /tax/i],
  ["relative_emergency", /relative|family|son|daughter|emergency|new number|impersonat/i],
  ["otp_request", /otp|one.?time|code|phish/i],
];

export function mapClaudeFamily(scamType: string | null | undefined): ScamFamily[] {
  if (!scamType) return [];
  return WORDS.filter(([, re]) => re.test(scamType)).map(([f]) => f);
}

export async function familiesView(db: Db): Promise<FamiliesView> {
  const run = await latestRun(db);
  const ai = run && run.summary.mode !== "rules" ? run : null;
  const items = testSet as { id: number; family: string; label: string; text: string }[];
  const rows: FamilyRow[] = (ai?.results ?? [])
    .filter((r) => r.label === "scam")
    .map((r) => {
      const ours = (r.ourFamily ?? null) as ScamFamily | null;
      const claude = r.aiScamType ?? null;
      const mapped = mapClaudeFamily(claude);
      const outcome: FamilyRow["outcome"] =
        r.aiStatus !== "ok" ? "no_ai" : !ours || ours === "pressure" ? "fallback" : mapped[0] === ours ? "agree" : mapped.includes(ours) ? "close" : "differ";
      return { id: r.id, text: r.text, testLabel: r.family, ours, claude, shown: ours ? TITLES[ours] : "—", outcome };
    });
  const compared = rows.filter((r) => r.outcome !== "no_ai");
  const checksWithType = await db.query.checks.findMany({ where: isNotNull(schema.checks.aiScamType), columns: { id: true } });
  return {
    run: ai ? { model: ai.summary.model, createdAt: ai.createdAt } : null,
    agree: compared.filter((r) => r.outcome === "agree" || r.outcome === "close").length,
    compared: compared.length,
    differ: compared.filter((r) => r.outcome === "differ").length,
    fallback: compared.filter((r) => r.outcome === "fallback").length,
    enumSize: ENUM.length,
    unmatchedTestLabels: [...new Set(items.filter((t) => t.label === "scam").map((t) => t.family))].filter((f) => !ENUM.includes(f as ScamFamily)),
    rows,
    storedOnChecks: checksWithType.length,
  };
}
