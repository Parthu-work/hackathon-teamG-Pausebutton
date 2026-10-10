import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_HOLD_MINUTES, INVITE_HOURS } from "@/lib/check/config";
import { findLinks, worstLink } from "@/lib/check/links";
import { normalizeForMatch } from "@/lib/check/normalize";
import { detectFamily } from "@/lib/check/rules";
import { formatPhone } from "@/lib/phone";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import campaigns from "@/data/campaigns.json";
import examples from "@/data/examples.json";
import simData from "@/data/sim-messages.json";
import { fingerprintOf, TITLES } from "./checks";
import { logEvent } from "./events";
import { log } from "./log";
import { clearSyntheticReports, seedReport } from "./reports";
import { seedInbox } from "./sim";
import { clearSyntheticSightings, recordSighting } from "./sightings";

// The demo household: Mr Rao ("Papa") and Mrs Rao ("Mummy") are both
// protected by their son Arjun and daughter Meera; Mr Rao's friend Dinesh is
// invited but has not joined. Arjun therefore protects two people.
//
// The "Call" buttons open the phone's dialer, so for a live demo set these to
// your teammates' real numbers in .env.local (DEMO_RAO_PHONE, DEMO_MOM_PHONE,
// DEMO_ARJUN_PHONE, DEMO_MEERA_PHONE). They are re-applied on every start.

const DEFAULT_PHONES = { rao: "+91 98765 43210", mom: "+91 98765 43211", arjun: "+91 91234 56789", meera: "+91 99887 76655" };
const ENV_PHONES = { rao: "DEMO_RAO_PHONE", mom: "DEMO_MOM_PHONE", arjun: "DEMO_ARJUN_PHONE", meera: "DEMO_MEERA_PHONE" } as const;

export const PERSONAS = {
  rao: { name: "Mr Rao", nickname: "Papa", role: "protected" as const },
  mom: { name: "Mrs Rao", nickname: "Mummy", role: "protected" as const },
  arjun: { name: "Arjun", nickname: null, role: "family" as const },
  meera: { name: "Meera", nickname: null, role: "family" as const },
};
export type Persona = keyof typeof PERSONAS;
export const PROTECTED_PERSONAS = ["rao", "mom"] as const;

export function personaPhone(persona: Persona) {
  const fromEnv = process.env[ENV_PHONES[persona]];
  return (fromEnv && formatPhone(fromEnv)) || DEFAULT_PHONES[persona];
}

type Trusted = { persona: "arjun" | "meera" | null; name: string; relation: string; code: string };
const TRUSTED: Record<(typeof PROTECTED_PERSONAS)[number], Trusted[]> = {
  rao: [
    { persona: "arjun", name: "Arjun", relation: "Son", code: "PB-4K7Q" },
    { persona: "meera", name: "Meera", relation: "Daughter", code: "PB-9M2X" },
    { persona: null, name: "Dinesh", relation: "Friend", code: "PB-7H3D" },
  ],
  mom: [
    { persona: "arjun", name: "Arjun", relation: "Son", code: "PB-2M8R" },
    { persona: "meera", name: "Meera", relation: "Daughter", code: "PB-5T6W" },
  ],
};
const DINESH_PHONE = "+91 90000 12345";

export async function personaUser(db: Db, persona: Persona) {
  return db.query.users.findFirst({ where: eq(schema.users.demoKey, persona) });
}

/** Creates the demo household once, and keeps the personas' phone numbers in line with .env.local. */
export async function ensureDemoHousehold(db: Db) {
  const created = new Set<Persona>();
  for (const [key, p] of Object.entries(PERSONAS) as [Persona, (typeof PERSONAS)[Persona]][]) {
    const phone = personaPhone(key);
    const existing = await personaUser(db, key);
    if (!existing) {
      const [u] = await db
        .insert(schema.users)
        .values({ ...p, phone, demoKey: key, isDemo: true, alertsReady: p.role === "family" })
        .onConflictDoNothing()
        .returning();
      if (!u) log.warn("demo_phone_in_use", { persona: key, outcome: "not created" }); // the number is another account's
      else created.add(key);
    } else if (existing.phone !== phone) {
      const clash = await db.query.users.findFirst({ where: eq(schema.users.phone, phone) });
      if (clash) {
        log.warn("demo_phone_in_use", { persona: key, outcome: "kept its old number" });
        continue;
      }
      await db.update(schema.users).set({ phone }).where(eq(schema.users.id, existing.id));
      await db.update(schema.links).set({ phone }).where(eq(schema.links.familyId, existing.id));
    }
  }
  for (const key of PROTECTED_PERSONAS) {
    if (!created.has(key)) continue;
    const owner = (await personaUser(db, key))!;
    await relinkTrusted(db, owner.id, TRUSTED[key]);
    await logEvent(db, owner.id, "Simulator", "seeded", `Demo household created for ${owner.name}`);
    await seedInbox(db, owner);
  }
  if (created.size) await seedOtherHouseholds(db);
}

type CampaignSeed = { example?: string; library?: number; text?: string; title?: string; households: number; today: number; firstSeenDaysAgo: number };

/**
 * The other households of the demo (F3, F9, F12): synthetic sightings of the
 * sample scams, so "47 other families got this today" has something to count,
 * and a review queue of reported links. Only fingerprints are stored.
 */
export async function seedOtherHouseholds(db: Db) {
  await clearSyntheticSightings(db);
  await clearSyntheticReports(db);
  const library = simData.library as { text: string }[];
  const now = Date.now();
  let slug = 0;
  for (const c of campaigns as CampaignSeed[]) {
    const text = c.text ?? (c.example ? examples.find((e) => e.id === c.example)?.text : undefined) ?? (c.library !== undefined ? library[c.library]?.text : undefined);
    if (!text) continue;
    slug += 1;
    const family = detectFamily(normalizeForMatch(text).text);
    const title = c.title ?? TITLES[family];
    const domain = worstLink(findLinks(text))?.domain ?? null;
    const print = fingerprintOf(text);
    const firstSeen = now - c.firstSeenDaysAgo * 86400_000;
    for (let i = 0; i < c.households; i++) {
      // The first `today` households saw it in the last 24 hours, spread evenly; the rest between first seen and yesterday.
      const seenAt =
        i < c.today
          ? now - Math.round(((i + 1) / (c.today + 1)) * 23 * 3600_000)
          : firstSeen + Math.round(((i - c.today + 1) / (c.households - c.today + 1)) * Math.max(1, now - 25 * 3600_000 - firstSeen));
      await recordSighting(db, { fingerprint: print, householdKey: `demo-${slug}-${i}`, family, title, domain, synthetic: true, seenAt: new Date(seenAt) });
    }
  }
  // The review queue (F9b): other families' reports. The demo household's own
  // members have not reported anything yet, so Arjun can report the KYC link live.
  await seedReport(db, { domain: "sbi-kyc-verify.in", reportedByName: "S. Mehta", daysAgo: 1 });
  await seedReport(db, { domain: "rbi-refund.xyz", reportedByName: "K. Reddy" });
  await seedReport(db, { domain: "onlinesbi.com", reportedByName: "S. Kumar" }); // official: refused on sight
  await seedReport(db, { domain: "parcel-duty-pay.top", reportedByName: "R. Nair", status: "blocked", daysAgo: 2 });
}

async function relinkTrusted(db: Db, ownerId: string, list: Trusted[]) {
  const expiry = new Date(Date.now() + INVITE_HOURS * 3600_000);
  for (const t of list) {
    const member = t.persona ? await personaUser(db, t.persona) : null;
    const phone = member?.phone ?? DINESH_PHONE;
    await db.delete(schema.links).where(and(eq(schema.links.protectedId, ownerId), eq(schema.links.phone, phone)));
    await db.delete(schema.links).where(eq(schema.links.inviteCode, t.code));
    await db.insert(schema.links).values({
      protectedId: ownerId,
      familyId: member?.id ?? null,
      name: t.name,
      relation: t.relation,
      phone,
      inviteCode: t.code,
      codeExpiresAt: expiry,
      status: member ? "linked" : "waiting",
      linkedAt: member ? new Date() : null,
    });
  }
}

/** J4 / L2 "Reset demo data": clears holds, checks, alerts and inboxes; keeps the family linked. */
export async function resetDemo(db: Db) {
  await ensureDemoHousehold(db);
  const familyIds = (await Promise.all([personaUser(db, "arjun"), personaUser(db, "meera")])).map((u) => u!.id);
  await db.update(schema.users).set({ alertsReady: true }).where(inArray(schema.users.id, familyIds));
  // The push delivery log of the demo household starts fresh too (alert rows cascade; test alerts do not).
  await db.delete(schema.pushDeliveries).where(inArray(schema.pushDeliveries.userId, [...familyIds, ...(await Promise.all(PROTECTED_PERSONAS.map((k) => personaUser(db, k)))).map((u) => u!.id)]));
  for (const key of PROTECTED_PERSONAS) {
    const owner = (await personaUser(db, key))!;
    await db.delete(schema.checks).where(eq(schema.checks.userId, owner.id)); // cascades to holds, alerts, answers, advice
    await db.delete(schema.simMessages).where(eq(schema.simMessages.userId, owner.id));
    await db.delete(schema.events).where(eq(schema.events.householdId, owner.id));
    await db
      .update(schema.users)
      .set({ watchSms: true, watchWhatsapp: true, unknownOnly: true, autoTellFamily: true, language: "en", textSize: "A", holdMinutes: DEFAULT_HOLD_MINUTES })
      .where(eq(schema.users.id, owner.id));
    await relinkTrusted(db, owner.id, TRUSTED[key]);
    await logEvent(db, owner.id, "Operator", "reset", `Demo data reset for ${owner.name} · holds and checks cleared · Arjun and Meera still linked`);
    await seedInbox(db, { ...owner, watchSms: true, watchWhatsapp: true, unknownOnly: true, autoTellFamily: true });
  }
  // Real sightings of the demo household go too; the synthetic other households come back fresh.
  await db.delete(schema.sightings).where(eq(schema.sightings.synthetic, false));
  await seedOtherHouseholds(db);
  // Rate-limit counters start fresh, so a run of demos (or the browser tests) is not throttled.
  await db.delete(schema.rateLimits);
  return (await personaUser(db, "rao"))!;
}
