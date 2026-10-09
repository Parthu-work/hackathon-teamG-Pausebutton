import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { familyCopy, rupees, verdictCopy } from "@/lib/check/copy";
import { normalizeForMatch } from "@/lib/check/normalize";
import { keyPhrases } from "@/lib/check/phrases";
import { finalVerdict } from "@/lib/check/final";
import { checkMessage, MAX_MESSAGE_CHARS } from "@/lib/check/pipeline";
import { SHARE_TEXT_HOURS } from "@/lib/check/config";
import type { CheckResult, ScamFamily } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { CheckView, SharedMessage } from "@/lib/views";
import { answerSummary, giveAnswer } from "./answers";
import { logEvent } from "./events";
import { adviceFor, assertLinked, createHold, holdStatus, toHoldView, userNames } from "./holds";
import { callNameOf, joinNames, linkedFamily, ownerView } from "./people";
import { logPushOutcome, notifyOwnerOfAdvice } from "./notify";
import { pushStatusByKey, pushToUsers } from "./push";
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
  const key = process.env.FINGERPRINT_SECRET ?? "pause-button-dev-fingerprint";
  return crypto.createHmac("sha256", key).update(normalized).digest("hex").slice(0, 32);
}

/** Push states after which an alerted person may not notice in time: the sender should call them. */
const UNREACHABLE = new Set(["no_device", "disabled", "failed"]);

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
  await purgeSharedText(db);
  const text = input.text.slice(0, MAX_MESSAGE_CHARS);
  const result = await checkMessage(text);
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
      // Family members who are alerted read the exact message (24 h). Safe messages are not kept.
      messageText: result.verdict === "SAFE" ? null : text,
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
  const rows = await db.insert(schema.alerts).values(recipientIds.map((recipientId) => ({ checkId: check.id, holdId, recipientId, kind }))).returning();
  const names = Object.values(await userNames(db, recipientIds));
  const what = kind === "urgent" ? "Urgent alert" : kind === "headsup" ? "Quiet heads-up" : "“Ask” request";
  await logEvent(db, owner.id, "Check service", "alert", `${what} sent to ${joinNames(names)}`, holdId);

  // Push notifications reach the family phones even when the app is closed or the
  // phone is locked. A tap opens this alert (/open resolves it, signed in or not).
  // One notification per check on each phone: an urgent alert replaces the earlier
  // heads-up about the same message instead of stacking next to it.
  const family = await linkedFamily(db, owner.id);
  const phrases = keyPhrases(check.signals, check.link, check.hardPhrases, 2).map((p) => `“${p}”`).join(" ");
  const pushed = await Promise.all(
    rows.map((a) => {
      const who = callNameOf(owner, family.find((f) => f.familyId === a.recipientId)?.relation);
      const text =
        kind === "urgent"
          ? { title: `${who} needs you now`, body: `${who} got a scam message${check.amount ? ` asking for ${rupees(check.amount)}` : ""}. Nothing is paid. Tell ${who} what to do.`, urgent: true }
          : kind === "headsup"
            ? { title: `Heads-up: ${who} got a ${check.verdict === "SCAM" ? "scam" : "suspicious"} message`, body: `${phrases || check.title}. ${who} has not tried to pay.`, urgent: false }
            : { title: `${who} is asking: is this message safe?`, body: phrases || check.title, urgent: false };
      return pushToUsers(
        db,
        [a.recipientId],
        { ...text, url: `/open?alert=${a.id}`, tag: `check-${check.id}`, app: "family" },
        { dedupeKey: `alert:${a.id}`, householdId: owner.id },
      );
    }),
  );
  await logPushOutcome(db, owner.id, pushed.flatMap((p) => p.results), holdId);
}

/** E2 "Ask Arjun": a suspicious (or safe) message goes to family for a decision. */
export async function askFamily(db: Db, owner: User, checkId: string, text?: string) {
  const check = await ownCheck(db, owner, checkId);
  if (check.askedFamilyAt) return;
  const family = await linkedFamily(db, owner.id);
  if (!family.length) throw new HttpError(400, "Add a trusted person first.");
  // A SAFE message's text was not kept; the phone sends it along so family can
  // read it too. It must be the same message that was checked.
  const shareText =
    !check.messageText && text && fingerprint(normalizeForMatch(text.slice(0, MAX_MESSAGE_CHARS)).text) === check.fingerprint
      ? text.slice(0, MAX_MESSAGE_CHARS)
      : undefined;
  await db
    .update(schema.checks)
    .set({ askedFamilyAt: new Date(), ...(shareText ? { messageText: shareText } : {}) })
    .where(eq(schema.checks.id, check.id));
  await sendAlerts(db, owner, check, family.map((f) => f.familyId), "ask", null);
}

/** G2: Mr Rao opens the payment anyway. It is locked and family gets an urgent alert. */
export async function openPayment(db: Db, owner: User, checkId: string) {
  const check = await ownCheck(db, owner, checkId);
  if (!check.amount) throw new HttpError(400, "This message does not ask for an amount.");
  const existing = await db.query.holds.findFirst({
    where: and(eq(schema.holds.checkId, check.id), eq(schema.holds.status, "pending")),
  });
  if (existing) return { holdId: existing.id };
  const hold = await createHold(db, check, owner);
  await logEvent(db, owner.id, owner.name, "pay_attempt", `${owner.name} opened the payment · ${rupees(hold.amount)} locked`, hold.id);
  const family = await linkedFamily(db, owner.id);
  await sendAlerts(db, owner, check, family.map((f) => f.familyId), "urgent", hold.id);
  return { holdId: hold.id };
}

/** Family answers a heads-up or "Ask" request: "It's a scam" / "This is not a scam". */
export async function setFamilyVerdict(db: Db, member: User, checkId: string, verdict: "scam" | "not_scam", note?: string) {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) throw new HttpError(404, "That message was not found.");
  await assertLinked(db, member, check.userId);
  const paused = await db.query.holds.findFirst({ where: and(eq(schema.holds.checkId, checkId), eq(schema.holds.status, "pending")) });
  if (paused) throw new HttpError(409, "A payment is paused for this message. Block or approve it on the payment screen.");
  const summary = await giveAnswer(db, member, check, verdict);
  if (note) {
    const [row] = await db.insert(schema.advice).values({ checkId, fromUserId: member.id, text: note }).returning();
    await notifyOwnerOfAdvice(db, row, check.userId, member.name);
  }
  return { final: summary.final, waitingFor: summary.waitingFor };
}

/** The message text family may read: only within 24 hours of the check. */
export function sharedText(check: Check): string | null {
  if (!check.messageText) return null;
  return Date.now() - check.createdAt.getTime() < SHARE_TEXT_HOURS * 3600_000 ? check.messageText : null;
}

/** Deletes message text older than 24 hours. */
export async function purgeSharedText(db: Db) {
  await db
    .update(schema.checks)
    .set({ messageText: null })
    .where(and(isNotNull(schema.checks.messageText), lt(schema.checks.createdAt, new Date(Date.now() - SHARE_TEXT_HOURS * 3600_000))));
}

/**
 * The exact message for a family member, once they open an alert about it.
 * Only people who were alerted or asked about this check can read it.
 */
export async function sharedMessageFor(db: Db, member: User, checkId: string): Promise<SharedMessage | null> {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) return null;
  const alerted = await db.query.alerts.findFirst({
    where: and(eq(schema.alerts.checkId, checkId), eq(schema.alerts.recipientId, member.id)),
  });
  const text = alerted ? sharedText(check) : null;
  if (!text) return null;
  return { text, signals: check.signals, link: check.link ?? null, source: check.source, senderLabel: check.senderLabel };
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
  const owner = (await db.query.users.findFirst({ where: eq(schema.users.id, check.userId) }))!;
  const helperFirst = family[0]?.name ?? "your family";
  const alertRows = await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, check.id) });
  const names = await userNames(db, [...alertRows.map((a) => a.recipientId), check.familyVerdictBy ?? ""]);
  const hold = await db.query.holds.findFirst({ where: eq(schema.holds.checkId, check.id), orderBy: desc(schema.holds.createdAt) });
  const sim = check.source === "paste" ? null : await db.query.simMessages.findFirst({ where: eq(schema.simMessages.checkId, check.id) });
  const copy = verdictCopy(check, helperFirst, check.safeHint === "bank" ? "debited" : "");
  const said = await answerSummary(db, check.id);
  const pushState = opts.ownerId ? await pushStatusByKey(db, alertRows.map((a) => `alert:${a.id}`)) : new Map();
  // Family members read the exact message only if they were alerted or asked about it.
  const memberNotAlerted = !!opts.member && !alertRows.some((a) => a.recipientId === opts.member!.id);
  const fc = check.verdict === "SAFE" ? null : familyCopy(check.family);

  return {
    id: check.id,
    source: check.source,
    senderLabel: check.senderLabel,
    title: check.title,
    verdict: check.verdict,
    finalVerdict: finalVerdict(check.verdict, check.familyVerdict),
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
    unreachableNames: family
      .filter((f) => alertRows.some((a) => a.recipientId === f.familyId && !a.openedAt && !a.handledAt && UNREACHABLE.has(pushState.get(`alert:${a.id}|${f.familyId}`)?.status ?? "")))
      .map((f) => names[f.familyId] ?? f.name),
    askedFamilyAt: check.askedFamilyAt?.toISOString() ?? null,
    familyVerdict: check.familyVerdict,
    familyVerdictByName: said.final ? joinNames(said.decidedBy) : null,
    answers: said.answers,
    waitingFor: said.waitingFor,
    canAnswer: !!opts.member && !said.final && said.recipients.includes(opts.member.id) && !said.answers.some((a) => a.memberId === opts.member!.id),
    simText: memberNotAlerted ? null : sim?.text ?? null,
    messageText: memberNotAlerted ? null : sharedText(check),
    owner: ownerView(owner, opts.member ? family.find((f) => f.familyId === opts.member!.id)?.relation : null),
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
  const decided = new Map<string, string>();
  for (const r of rows.filter((x) => x.familyVerdict)) decided.set(r.id, joinNames((await answerSummary(db, r.id)).decidedBy));
  return rows.map((c) => {
    const hold = holds.find((h) => h.checkId === c.id);
    return {
      id: c.id,
      title: c.title,
      verdict: finalVerdict(c.verdict, c.familyVerdict),
      checkedBy: decided.get(c.id) || null,
      source: c.source,
      createdAt: c.createdAt.toISOString(),
      phrases: keyPhrases(c.signals, c.link, c.hardPhrases, 2),
      holdStatus: hold ? holdStatus(hold) : null,
    };
  });
}

export async function deleteHistory(db: Db, owner: User) {
  await db.delete(schema.checks).where(eq(schema.checks.userId, owner.id));
  await logEvent(db, owner.id, owner.name, "history_deleted", `${owner.name} deleted their check history`);
}
