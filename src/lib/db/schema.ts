import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { AiStatus, Evidence, HardRule, LinkInfo, ScamFamily, Verdict } from "../check/types";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  role: text("role").$type<"protected" | "family">(),
  isDemo: boolean("is_demo").notNull().default(false),
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

/** One checked message. The message text is never stored, only the fingerprint and warning phrases. */
export const checks = pgTable("checks", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").$type<"paste" | "sms" | "whatsapp">().notNull(),
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
  degraded: boolean("degraded").notNull().default(false),
  safeHint: text("safe_hint"),
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

export const testRuns = pgTable("test_runs", {
  id: id(),
  mode: text("mode").$type<"rules" | "haiku" | "sonnet">().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  createdAt: createdAt(),
});
