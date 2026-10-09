import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { APP_UTC_OFFSET_MINUTES } from "@/lib/check/config";
import { keyPhrases } from "@/lib/check/phrases";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { ActivityItem, AlertView, FamilyState, MeView, RaoState } from "@/lib/views";
import { logEvent } from "./events";
import { holdStatus, latestHoldFor, toHoldView, userNames } from "./holds";
import { linkedFamily, listPeople } from "./people";
import { latestBanner } from "./sim";

type User = typeof schema.users.$inferSelect;

export function toMeView(u: User): MeView {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    textSize: u.textSize,
    language: u.language,
    watchSms: u.watchSms,
    watchWhatsapp: u.watchWhatsapp,
    unknownOnly: u.unknownOnly,
    autoTellFamily: u.autoTellFamily,
  };
}

/** Midnight today in India, whatever time zone the server runs in (Vercel runs in UTC). */
export function startOfToday(now = Date.now()) {
  const offset = APP_UTC_OFFSET_MINUTES * 60_000;
  const local = now + offset;
  return new Date(local - (local % 86_400_000) - offset);
}

/** Polled every 2 s by Mr Rao's phone. */
export async function raoState(db: Db, me: User): Promise<RaoState> {
  await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, me.id));
  const [people, family, pending, decided, banner] = await Promise.all([
    listPeople(db, me.id),
    linkedFamily(db, me.id),
    latestHoldFor(db, me.id, ["pending"]),
    db.query.holds.findFirst({
      where: and(eq(schema.holds.userId, me.id), inArray(schema.holds.status, ["blocked", "approved"]), isNull(schema.holds.outcomeSeenAt)),
      orderBy: desc(schema.holds.decidedAt),
    }),
    latestBanner(db, me.id),
  ]);
  return {
    me: toMeView(me),
    people,
    helperNames: family.map((f) => f.name),
    activeHold: pending ? await toHoldView(db, pending) : null,
    outcome: decided ? await toHoldView(db, decided) : null,
    banner,
    serverNow: new Date().toISOString(),
  };
}

/** Polled every 2 s by Arjun's phone. */
export async function familyState(db: Db, me: User): Promise<FamilyState> {
  const link = await db.query.links.findFirst({
    where: and(eq(schema.links.familyId, me.id), eq(schema.links.status, "linked")),
  });
  const base = {
    me: { id: me.id, name: me.name, alertNotify: me.alertNotify, alertSound: me.alertSound, alertVibrate: me.alertVibrate, alertsReady: me.alertsReady },
    serverNow: new Date().toISOString(),
  };
  if (!link) return { ...base, protectedUser: null, alerts: [], activeHold: null, lastCheck: null, today: { total: 0, scam: 0, suspicious: 0, safe: 0 } };

  const owner = (await db.query.users.findFirst({ where: eq(schema.users.id, link.protectedId) }))!;
  const since = new Date(Date.now() - 24 * 3600_000);
  const alertRows = await db.query.alerts.findMany({
    where: and(eq(schema.alerts.recipientId, me.id), isNull(schema.alerts.handledAt), gte(schema.alerts.createdAt, since)),
    orderBy: desc(schema.alerts.createdAt),
    limit: 10,
  });

  // The first poll that sees a new alert is when it "reached" this phone.
  const fresh = alertRows.filter((a) => !a.deliveredAt);
  if (fresh.length) {
    await db.update(schema.alerts).set({ deliveredAt: new Date() }).where(inArray(schema.alerts.id, fresh.map((a) => a.id)));
    for (const a of fresh) {
      await logEvent(db, owner.id, me.name, "delivered", `${me.name}'s phone polled · new ${a.kind === "urgent" ? "hold alert" : a.kind === "headsup" ? "heads-up" : "question"}`, a.holdId);
    }
  }

  const checkIds = [...new Set(alertRows.map((a) => a.checkId))];
  const checks = checkIds.length ? await db.query.checks.findMany({ where: inArray(schema.checks.id, checkIds) }) : [];
  const others = checkIds.length
    ? await db.query.alerts.findMany({ where: inArray(schema.alerts.checkId, checkIds) })
    : [];
  const names = await userNames(db, others.map((o) => o.recipientId));

  const alerts: AlertView[] = alertRows.flatMap((a) => {
    const c = checks.find((x) => x.id === a.checkId);
    if (!c) return [];
    return [{
      id: a.id,
      kind: a.kind,
      checkId: a.checkId,
      holdId: a.holdId,
      createdAt: a.createdAt.toISOString(),
      openedAt: a.openedAt?.toISOString() ?? null,
      handledAt: a.handledAt?.toISOString() ?? null,
      verdict: c.verdict,
      title: c.title,
      phrases: keyPhrases(c.signals, c.link, c.hardPhrases),
      amount: c.amount,
      source: c.source,
      senderLabel: c.senderLabel,
      otherRecipients: [...new Set(others.filter((o) => o.checkId === a.checkId && o.recipientId !== me.id).map((o) => names[o.recipientId]).filter(Boolean))],
    }];
  });

  const pending = await latestHoldFor(db, owner.id, ["pending"]);
  const todays = await db.query.checks.findMany({ where: and(eq(schema.checks.userId, owner.id), gte(schema.checks.createdAt, startOfToday())) });
  const last = await db.query.checks.findFirst({ where: eq(schema.checks.userId, owner.id), orderBy: desc(schema.checks.createdAt) });

  return {
    ...base,
    protectedUser: {
      id: owner.id,
      name: owner.name,
      phone: owner.phone,
      online: !!owner.lastSeenAt && Date.now() - owner.lastSeenAt.getTime() < 15_000,
      relation: link.relation,
      linkId: link.id,
    },
    alerts,
    activeHold: pending ? await toHoldView(db, pending) : null,
    lastCheck: last
      ? { id: last.id, verdict: last.verdict, title: last.title, createdAt: last.createdAt.toISOString(), phrases: keyPhrases(last.signals, last.link, last.hardPhrases, 2) }
      : null,
    today: {
      total: todays.length,
      scam: todays.filter((c) => c.verdict === "SCAM").length,
      suspicious: todays.filter((c) => c.verdict === "SUSPICIOUS").length,
      safe: todays.filter((c) => c.verdict === "SAFE").length,
    },
  };
}

/** J3: what the family member sees about Papa's checks and holds. */
export async function familyActivity(db: Db, ownerId: string): Promise<ActivityItem[]> {
  const checks = await db.query.checks.findMany({ where: eq(schema.checks.userId, ownerId), orderBy: desc(schema.checks.createdAt), limit: 40 });
  const holds = await db.query.holds.findMany({ where: eq(schema.holds.userId, ownerId), orderBy: desc(schema.holds.createdAt), limit: 20 });
  const names = await userNames(db, holds.map((h) => h.decidedById ?? ""));
  const items: ActivityItem[] = checks.map((c) => ({
    id: c.id,
    kind: "check",
    label: c.verdict,
    title: c.title,
    phrases: keyPhrases(c.signals, c.link, c.hardPhrases, 2),
    createdAt: c.createdAt.toISOString(),
    checkId: c.id,
  }));
  for (const h of holds) {
    const status = holdStatus(h);
    if (status === "pending" || status === "expired" || !h.decidedAt) continue;
    const who = h.decidedById ? names[h.decidedById] ?? "Someone" : "Someone";
    const label = status === "blocked" ? "BLOCKED" : status === "approved" ? "APPROVED" : "CANCELLED";
    items.push({
      id: h.id,
      kind: "hold",
      label,
      title: `${who} ${status} Rs ${h.amount.toLocaleString("en-IN")}`,
      phrases: [],
      createdAt: h.decidedAt.toISOString(),
      checkId: h.checkId,
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
