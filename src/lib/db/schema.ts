import { boolean, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { AiStatus, CallAnswers, CheckSource, Evidence, HardRule, LinkInfo, ScamFamily, Verdict } from "../check/types";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  /** What the family calls this person ("Papa", "Mummy"); shown on family phones instead of the name. */
  nickname: text("nickname"),
  phone: text("phone").notNull().unique(),
  role: text("role").$type<"protected" | "family">(),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Stable id of a demo persona ("rao", "arjun", "meera"), so its phone number can be changed. */
  demoKey: text("demo_key").unique(),
  // Mr Rao's settings (K2, M4)
  textSize: text("text_size").$type<"A" | "A+" | "A++">().notNull().default("A"),
  language: text("language").notNull().default("en"),
  watchSms: boolean("watch_sms").notNull().default(true),
  watchWhatsapp: boolean("watch_whatsapp").notNull().default(true),
  unknownOnly: boolean("unknown_only").notNull().default(true),
  autoTellFamily: boolean("auto_tell_family").notNull().default(true),
  // Family member's alert settings (C2, J4)
  alertNotify: boolean("alert_notify").notNull().default(true),
  alertSound: boolean("alert_sound").notNull().default(true),
  alertVibrate: boolean("alert_vibrate").notNull().default(true),
  alertsReady: boolean("alerts_ready").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A trusted person of a protected user (B1–B5, C1). */
export const links = pgTable("links", {
  id: id(),
  protectedId: text("protected_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  familyId: text("family_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  relation: text("relation").notNull(),
  phone: text("phone").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }).notNull(),
  status: text("status").$type<"waiting" | "linked">().notNull().default("waiting"),
  earlyHeadsUp: boolean("early_heads_up").notNull().default(true),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * One checked message: fingerprint, verdict and warning phrases. The full text
 * is kept only for SCAM and SUSPICIOUS messages, for 24 hours, so the family
 * members who are alerted can read exactly what was received (messageText).
 */
export const checks = pgTable("checks", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** paste · sms/whatsapp (detected) · share (forwarded, F1) · voice (spoken, F10) · call (live-call guard, F6). */
  source: text("source").$type<CheckSource>().notNull(),
  senderLabel: text("sender_label"),
  title: text("title").notNull(),
  fingerprint: text("fingerprint").notNull(),
  verdict: text("verdict").$type<Verdict>().notNull(),
  score: integer("score").notNull(),
  rulesScore: integer("rules_score").notNull(),
  modelScore: integer("model_score"),
  hardRule: text("hard_rule").$type<HardRule>(),
  decidedBy: text("decided_by").$type<"hard_rule" | "score" | "ai">().notNull(),
  signals: jsonb("signals").$type<Evidence[]>().notNull(),
  hardPhrases: jsonb("hard_phrases").$type<{ phrase: string; start: number; end: number }[]>().notNull(),
  link: jsonb("link").$type<LinkInfo | null>(),
  family: text("family").$type<ScamFamily>(),
  amount: integer("amount"),
  amountText: text("amount_text"),
  payee: text("payee"),
  modelTerms: jsonb("model_terms").$type<string[]>().notNull(),
  aiStatus: text("ai_status").$type<AiStatus>().notNull(),
  aiModel: text("ai_model"),
  /** The trick as Claude named it ("fake courier fee"), kept so the story we show can be measured (F7). */
  aiScamType: text("ai_scam_type"),
  /** No rule matched; the AI's own quoted phrases convicted it (F8). */
  novel: boolean("novel").notNull().default(false),
  /** Live-call guard: the three answers (F6). */
  callAnswers: jsonb("call_answers").$type<CallAnswers | null>(),
  degraded: boolean("degraded").notNull().default(false),
  safeHint: text("safe_hint"),
  messageText: text("message_text"),
  askedFamilyAt: timestamp("asked_family_at", { withTimezone: true }),
  familyVerdict: text("family_verdict").$type<"scam" | "not_scam">(),
  familyVerdictBy: text("family_verdict_by").references(() => users.id, { onDelete: "set null" }),
  familyVerdictAt: timestamp("family_verdict_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A paused payment (G2, H1–H5, I2–I4, J1–J2). Expiry is derived from expiresAt. */
export const holds = pgTable("holds", {
  id: id(),
  checkId: text("check_id").notNull().references(() => checks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  payee: text("payee").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").$type<"pending" | "blocked" | "approved" | "cancelled">().notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedById: text("decided_by_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  outcomeSeenAt: timestamp("outcome_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const advice = pgTable("advice", {
  id: id(),
  checkId: text("check_id").notNull().references(() => checks.id, { onDelete: "cascade" }),
  holdId: text("hold_id").references(() => holds.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: createdAt(),
});

/**
 * One family member's answer about a message: "scam" or "not_scam". Blocking
 * a payment is a "scam" answer and approving one is "not_scam". One "scam"
 * settles it; "not_scam" only counts once everyone who was alerted agrees.
 */
export const answers = pgTable(
  "answers",
  {
    id: id(),
    checkId: text("check_id").notNull().references(() => checks.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<"scam" | "not_scam">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("answers_check_member").on(t.checkId, t.memberId)],
);

/** urgent = scam or payment (I1), headsup = quiet amber alert (O1), ask = "Ask Arjun" on a suspicious message. */
export const alerts = pgTable("alerts", {
  id: id(),
  checkId: text("check_id").notNull().references(() => checks.id, { onDelete: "cascade" }),
  holdId: text("hold_id").references(() => holds.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"urgent" | "headsup" | "ask">().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Live event log for the demo panel (L2) and the timeline on I4. */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  householdId: text("household_id").notNull(),
  holdId: text("hold_id"),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

/**
 * The simulated phone inbox (P1). It stands in for the phone's own SMS and
 * WhatsApp apps, so it holds message text, but only made-up demo messages.
 */
export const simMessages = pgTable("sim_messages", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").$type<"sms" | "whatsapp">().notNull(),
  sender: text("sender").notNull(),
  fromContact: boolean("from_contact").notNull().default(false),
  text: text("text").notNull(),
  checkId: text("check_id").references(() => checks.id, { onDelete: "set null" }),
  bannerSeenAt: timestamp("banner_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Web Push subscriptions: one row per phone (browser) that asked to be alerted while the app is closed. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * A paired Android phone that watches incoming messages (M1–M4). Pairing is a
 * short-lived code the phone exchanges for a long-lived token; only the token's
 * hash is stored. The phone posts what it sees to /api/device/inbox.
 */
export const devices = pgTable("devices", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Android phone"),
  pairingCode: text("pairing_code").unique(),
  pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
  tokenHash: text("token_hash").unique(),
  pairedAt: timestamp("paired_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  listenerOn: boolean("listener_on").notNull().default(false),
  messagesSeen: integer("messages_seen").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Campaign radar (F3): one row per scam or suspicious message seen by a
 * household, keyed by the message fingerprint only. No text is stored, so two
 * families that got the same message make the same fingerprint and nothing
 * else. Synthetic rows stand in for other households in the demo.
 */
export const sightings = pgTable("sightings", {
  id: id(),
  fingerprint: text("fingerprint").notNull(),
  /** The protected person's id for real checks; a made-up key for synthetic demo households. */
  householdKey: text("household_key").notNull(),
  family: text("family").$type<ScamFamily>(),
  title: text("title").notNull(),
  /** The worst link's domain, when the message had one (F9: "11 families protected"). */
  domain: text("domain"),
  synthetic: boolean("synthetic").notNull().default(false),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Family-reported domains (F9). A report waits for a reviewer; "blocked" rows
 * join the live blocklist with no redeploy. Official bank domains can never be
 * reported, let alone blocked.
 */
export const reportedDomains = pgTable("reported_domains", {
  id: id(),
  domain: text("domain").notNull(),
  reportedById: text("reported_by_id").references(() => users.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name").notNull(),
  checkId: text("check_id").references(() => checks.id, { onDelete: "set null" }),
  status: text("status").$type<"pending" | "blocked" | "rejected">().notNull().default("pending"),
  /** What the link checker already says about it: lookalike, risky (odd ending), unknown. */
  autoCheck: text("auto_check").notNull(),
  autoReason: text("auto_reason").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const testRuns = pgTable("test_runs", {
  id: id(),
  mode: text("mode").$type<"rules" | "haiku" | "sonnet">().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  createdAt: createdAt(),
});
