import { and, eq, inArray } from "drizzle-orm";
import { INVITE_HOURS } from "@/lib/check/config";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";
import { seedInbox } from "./sim";

// The demo household from the designs: Mr Rao, his son Arjun and daughter
// Meera (both linked), and his friend Dinesh (invited, not joined yet).

export const PERSONAS = {
  rao: { name: "Mr Rao", phone: "+91 98765 43210", role: "protected" as const },
  arjun: { name: "Arjun", phone: "+91 91234 56789", role: "family" as const },
  meera: { name: "Meera", phone: "+91 99887 76655", role: "family" as const },
};
export type Persona = keyof typeof PERSONAS;

const TRUSTED = [
  { persona: "arjun" as const, name: "Arjun", relation: "Son", phone: PERSONAS.arjun.phone, code: "PB-4K7Q" },
  { persona: "meera" as const, name: "Meera", relation: "Daughter", phone: PERSONAS.meera.phone, code: "PB-9M2X" },
  { persona: null, name: "Dinesh", relation: "Friend", phone: "+91 90000 12345", code: "PB-7H3D" },
];

export async function personaUser(db: Db, persona: Persona) {
  return db.query.users.findFirst({ where: eq(schema.users.phone, PERSONAS[persona].phone) });
}

export async function ensureDemoHousehold(db: Db) {
  if (await personaUser(db, "rao")) return;
  const ids: Partial<Record<Persona, string>> = {};
  for (const [key, p] of Object.entries(PERSONAS) as [Persona, (typeof PERSONAS)[Persona]][]) {
    const [u] = await db
      .insert(schema.users)
      .values({ ...p, isDemo: true, alertsReady: p.role === "family" })
      .onConflictDoNothing()
      .returning();
    if (u) ids[key] = u.id;
  }
  if (!ids.rao) return; // another process seeded it first
  await relinkTrusted(db, ids.rao);
  const rao = (await personaUser(db, "rao"))!;
  await logEvent(db, rao.id, "Simulator", "seeded", "Demo household created");
  await seedInbox(db, rao);
}

async function relinkTrusted(db: Db, raoId: string) {
  const expiry = new Date(Date.now() + INVITE_HOURS * 3600_000);
  for (const t of TRUSTED) {
    const member = t.persona ? await personaUser(db, t.persona) : null;
    await db.delete(schema.links).where(and(eq(schema.links.protectedId, raoId), eq(schema.links.phone, t.phone)));
    await db.delete(schema.links).where(eq(schema.links.inviteCode, t.code));
    await db.insert(schema.links).values({
      protectedId: raoId,
      familyId: member?.id ?? null,
      name: t.name,
      relation: t.relation,
      phone: t.phone,
      inviteCode: t.code,
      codeExpiresAt: expiry,
      status: member ? "linked" : "waiting",
      linkedAt: member ? new Date() : null,
    });
  }
}

/** J4 / L2 "Reset demo data": clears holds, checks, alerts and the inbox; keeps family linked. */
export async function resetDemo(db: Db) {
  await ensureDemoHousehold(db);
  const rao = (await personaUser(db, "rao"))!;
  await db.delete(schema.checks).where(eq(schema.checks.userId, rao.id)); // cascades to holds, alerts, advice
  await db.delete(schema.simMessages).where(eq(schema.simMessages.userId, rao.id));
  await db.delete(schema.events).where(eq(schema.events.householdId, rao.id));
  await db
    .update(schema.users)
    .set({ watchSms: true, watchWhatsapp: true, unknownOnly: true, autoTellFamily: true })
    .where(eq(schema.users.id, rao.id));
  const familyIds = (await Promise.all([personaUser(db, "arjun"), personaUser(db, "meera")])).map((u) => u!.id);
  await db.update(schema.users).set({ alertsReady: true }).where(inArray(schema.users.id, familyIds));
  await relinkTrusted(db, rao.id);
  await seedInbox(db, { ...rao, watchSms: true, watchWhatsapp: true, unknownOnly: true, autoTellFamily: true });
  await logEvent(db, rao.id, "Operator", "reset", "Demo data reset · holds and checks cleared · Arjun and Meera still linked");
  return rao;
}
