import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { familyCopy, rupees, verdictCopy } from "@/lib/check/copy";
import { normalizeForMatch } from "@/lib/check/normalize";
import { keyPhrases } from "@/lib/check/phrases";
import { checkMessage } from "@/lib/check/pipeline";
import type { CheckResult, ScamFamily } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { CheckView } from "@/lib/views";
import { logEvent } from "./events";
import { adviceFor, assertLinked, createHold, holdStatus, toHoldView, userNames } from "./holds";
import { joinNames, linkedFamily } from "./people";
import { secretFromEnv } from "./secrets";
import { HttpError } from "./session";

type User = typeof schema.users.$inferSelect;
type Check = typeof schema.checks.$inferSelect;

const TITLES: Record<ScamFamily, string> = {
  fake_officer: "Fake officer message",
  bank_kyc: "Bank KYC link",
  courier_fee: "Courier fee message",
  lottery: "Lottery win message",
  task_job: "Task job offer",
  wrong_upi_refund: "“Sent by mistake” message",
  qr_receive: "QR code payment",
  power_cut: "Power cut message",
  relative_emergency: "Family emergency message",
  investment: "Investment offer",
  loan_fee: "Loan offer",
  sim_block: "SIM block message",
  tax_refund: "Tax refund message",
  remote_access: "Screen-sharing request",
  otp_request: "OTP request",
  pressure: "Pressure message",
};

function defaultTitle(r: CheckResult, normalized: string) {
  if (r.family) return TITLES[r.family];
  if (/debited|credited|a\/c|avl bal|account ending/.test(normalized)) return "Bank alert";
  return "Message";
}

/** A keyed hash of the normalised text: lets us spot repeats without keeping the message. */
function fingerprint(normalized: string) {
  const key = secretFromEnv("FINGERPRINT_SECRET", "pause-button-dev-fingerprint");
  return crypto.createHmac("sha256", key).update(normalized).digest("hex").slice(0, 32);
}

export type NewCheck = {
  text: string;
  source: "paste" | "sms" | "whatsapp";
  senderLabel?: string | null;
  title?: string | null;
};

/**
 * Runs the check, stores the result (never the message text) and does what
 * the verdict calls for:
 *  - pasted SCAM: urgent alert to every linked family member, plus a
 *    10-minute payment hold when the message asks for an amount;
 *  - detected SCAM (simulated inbox): a quiet heads-up, if Mr Rao turned on
 *    "Tell Arjun automatically"; the hold starts if he then tries to pay.
 */
export async function createCheck(db: Db, owner: User, input: NewCheck) {
  const result = await checkMessage(input.text);
  const normalized = normalizeForMatch(input.text).text;
  const [check] = await db
    .insert(schema.checks)
    .values({
      userId: owner.id,
      source: input.source,
      senderLabel: input.senderLabel ?? null,
      title: input.title || defaultTitle(result, normalized),
      fingerprint: fingerprint(normalized),
      verdict: result.verdict,
      score: result.score,
      rulesScore: result.rulesScore,
      modelScore: result.modelScore,
      hardRule: result.hardRule,
      decidedBy: result.decidedBy,
      signals: result.signals,
      hardPhrases: result.hardPhrases,
      link: result.link,
      family: result.family,
      amount: result.amount?.value ?? null,
      amountText: result.amount?.text ?? null,
      payee: result.payee,
      modelTerms: result.modelTerms,
      aiStatus: result.ai.status,
      aiModel: result.ai.model ?? null,
      degraded: result.degraded,
      safeHint: result.verdict === "SAFE" && /debited|credited|a\/c|avl bal|account ending/.test(normalized) ? "bank" : null,
    })
    .returning();

  const how = result.hardRule ? `hard rule ${result.hardRule}` : `${result.score}%`;
  const from = input.source === "paste" ? "pasted" : `${input.source.toUpperCase()} from ${input.senderLabel}`;
  await logEvent(db, owner.id, "Check service", "verdict", `Verdict ${result.verdict} (${how}) · ${from}`);

  let holdId: string | null = null;
  if (result.verdict === "SCAM") {
    const family = await linkedFamily(db, owner.id);
    if (input.source === "paste") {
      if (check.amount) {
        const hold = await createHold(db, check, owner);
        holdId = hold.id;
        await logEvent(db, owner.id, "Check service", "hold", `Hold created automatically · ${rupees(hold.amount)} paused for 10 min`, hold.id);
      }
      await sendAlerts(db, owner, check, family.map((f) => f.familyId), "urgent", holdId);
    } else if (owner.autoTellFamily) {
      const recipients = family.filter((f) => f.earlyHeadsUp).map((f) => f.familyId);
      await sendAlerts(db, owner, check, recipients, "headsup", null);
    }
  }
  return { checkId: check.id, holdId, verdict: check.verdict };
}

async function sendAlerts(
  db: Db,
  owner: User,
  check: Check,
  recipientIds: string[],
  kind: "urgent" | "headsup" | "ask",
  holdId: string | null,
) {
  if (!recipientIds.length) return;
  await db.insert(schema.alerts).values(recipientIds.map((recipientId) => ({ checkId: check.id, holdId, recipientId, kind })));
  const names = Object.values(await userNames(db, recipientIds));
  const what = kind === "urgent" ? "Urgent alert" : kind === "headsup" ? "Quiet heads-up" : "“Ask” request";
  await logEvent(db, owner.id, "Check service", "alert", `${what} sent to ${joinNames(names)}`, holdId);
}

/** E2 "Ask Arjun": a suspicious (or safe) message goes to family for a decision. */
export async function askFamily(db: Db, owner: User, checkId: string) {
  const check = await ownCheck(db, owner, checkId);
  if (check.askedFamilyAt) return;
  const family = await linkedFamily(db, owner.id);
  if (!family.length) throw new HttpError(400, "Add a trusted person first.");
  await db.update(schema.checks).set({ askedFamilyAt: new Date() }).where(eq(schema.checks.id, check.id));
  await sendAlerts(db, owner, check, family.map((f) => f.familyId), "ask", null);
}

/** G2: Mr Rao opens the payment anyway. It is locked and family gets an urgent alert. */
export async function openPayment(db: Db, owner: User, checkId: string) {
  const check = await ownCheck(db, owner, checkId);
  if (!check.amount) throw new HttpError(400, "This message does not ask for an amount.");
  // Family's decision sticks: a blocked payment stays blocked, and an open or
  // approved hold is reused. Only a hold he cancelled himself can start again.
  const latest = await db.query.holds.findFirst({
    where: eq(schema.holds.checkId, check.id),
    orderBy: desc(schema.holds.createdAt),
  });
  if (latest?.status === "blocked") {
    const names = await userNames(db, [latest.decidedById ?? ""]);
    const who = (latest.decidedById && names[latest.decidedById]) || "Your family";
    throw new HttpError(409, `${who} blocked this payment. It cannot be paid.`);
  }
  if (latest && latest.status !== "cancelled") return { holdId: latest.id, status: holdStatus(latest) };
  const hold = await createHold(db, check, owner);
  await logEvent(db, owner.id, owner.name, "pay_attempt", `${owner.name} opened the payment · ${rupees(hold.amount)} locked`, hold.id);
  const family = await linkedFamily(db, owner.id);
  await sendAlerts(db, owner, check, family.map((f) => f.familyId), "urgent", hold.id);
  return { holdId: hold.id, status: holdStatus(hold) };
}

/** Family answers a heads-up or "Ask" request: "It's a scam" / "This is not a scam". The first answer wins. */
export async function setFamilyVerdict(db: Db, member: User, checkId: string, verdict: "scam" | "not_scam", note?: string) {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) throw new HttpError(404, "That message was not found.");
  await assertLinked(db, member, check.userId);
  const [answered] = await db
    .update(schema.checks)
    .set({ familyVerdict: verdict, familyVerdictBy: member.id, familyVerdictAt: new Date() })
    .where(and(eq(schema.checks.id, checkId), isNull(schema.checks.familyVerdict)))
    .returning();
  if (!answered) {
    // Like a hold decision: a later "not a scam" must never undo "it's a scam".
    const current = (await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) })) ?? check;
    const names = await userNames(db, [current.familyVerdictBy ?? ""]);
    const who = (current.familyVerdictBy && names[current.familyVerdictBy]) || "Someone";
    throw new HttpError(409, `${who} already answered: ${current.familyVerdict === "scam" ? "it is a scam" : "it is not a scam"}.`);
  }
  if (note) await db.insert(schema.advice).values({ checkId, fromUserId: member.id, text: note });
  await db
    .update(schema.alerts)
    .set({ handledAt: new Date() })
    .where(and(eq(schema.alerts.checkId, checkId), isNull(schema.alerts.handledAt), isNull(schema.alerts.holdId)));
  await logEvent(db, check.userId, member.name, "family_verdict", `${member.name} marked it ${verdict === "scam" ? "a scam" : "not a scam"}`);
}

async function ownCheck(db: Db, owner: User, checkId: string) {
  const check = await db.query.checks.findFirst({ where: and(eq(schema.checks.id, checkId), eq(schema.checks.userId, owner.id)) });
  if (!check) throw new HttpError(404, "That check was not found.");
  return check;
}

export async function getCheckView(db: Db, checkId: string, opts: { ownerId?: string; member?: User }): Promise<CheckView> {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) throw new HttpError(404, "That check was not found.");
  if (opts.ownerId && check.userId !== opts.ownerId) throw new HttpError(404, "That check was not found.");
  if (opts.member) await assertLinked(db, opts.member, check.userId);

  const family = await linkedFamily(db, check.userId);
  const helperFirst = family[0]?.name ?? "your family";
  const alertRows = await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, check.id) });
  const names = await userNames(db, [...alertRows.map((a) => a.recipientId), check.familyVerdictBy ?? ""]);
  const hold = await db.query.holds.findFirst({ where: eq(schema.holds.checkId, check.id), orderBy: desc(schema.holds.createdAt) });
  const sim = check.source === "paste" ? null : await db.query.simMessages.findFirst({ where: eq(schema.simMessages.checkId, check.id) });
  const copy = verdictCopy(check, helperFirst, check.safeHint === "bank" ? "debited" : "");
  const fc = check.verdict === "SAFE" ? null : familyCopy(check.family);

  return {
    id: check.id,
    source: check.source,
    senderLabel: check.senderLabel,
    title: check.title,
    verdict: check.verdict,
    score: check.score,
    rulesScore: check.rulesScore,
    modelScore: check.modelScore,
    hardRule: check.hardRule,
    decidedBy: check.decidedBy,
    signals: check.signals,
    hardPhrases: check.hardPhrases,
    link: check.link ?? null,
    family: check.family,
    familyTitle: fc?.title ?? null,
    familyStory: fc?.story ?? null,
    headline: copy.headline,
    body: copy.body,
    amount: check.amount,
    amountText: check.amountText,
    payee: check.payee,
    modelTerms: check.modelTerms,
    aiStatus: check.aiStatus,
    aiModel: check.aiModel,
    degraded: check.degraded,
    createdAt: check.createdAt.toISOString(),
    alertedNames: family.filter((f) => alertRows.some((a) => a.kind !== "ask" && a.recipientId === f.familyId)).map((f) => names[f.familyId] ?? f.name),
    askedFamilyAt: check.askedFamilyAt?.toISOString() ?? null,
    familyVerdict: check.familyVerdict,
    familyVerdictByName: check.familyVerdictBy ? names[check.familyVerdictBy] ?? null : null,
    simText: sim?.text ?? null,
    hold: hold ? await toHoldView(db, hold, check) : null,
    advice: await adviceFor(db, { checkId: check.id }),
  };
}

export async function listChecks(db: Db, userId: string) {
  const rows = await db.query.checks.findMany({
    where: eq(schema.checks.userId, userId),
    orderBy: desc(schema.checks.createdAt),
    limit: 50,
  });
  const holds = rows.length
    ? await db.query.holds.findMany({ where: inArray(schema.holds.checkId, rows.map((r) => r.id)) })
    : [];
  return rows.map((c) => {
    const hold = holds.find((h) => h.checkId === c.id);
    return {
      id: c.id,
      title: c.title,
      verdict: c.verdict,
      source: c.source,
      createdAt: c.createdAt.toISOString(),
      phrases: keyPhrases(c.signals, c.link, c.hardPhrases, 2),
      holdStatus: hold ? holdStatus(hold) : null,
    };
  });
}

/** P3 "Delete my history". A payment still on hold stays until family decides, so their Block still reaches it. */
export async function deleteHistory(db: Db, owner: User) {
  const open = await db.query.holds.findMany({
    where: and(eq(schema.holds.userId, owner.id), eq(schema.holds.status, "pending")),
  });
  const keep = [...new Set(open.map((h) => h.checkId))];
  await db
    .delete(schema.checks)
    .where(keep.length ? and(eq(schema.checks.userId, owner.id), notInArray(schema.checks.id, keep)) : eq(schema.checks.userId, owner.id));
  await logEvent(db, owner.id, owner.name, "history_deleted", `${owner.name} deleted their check history`);
  return { kept: keep.length };
}
