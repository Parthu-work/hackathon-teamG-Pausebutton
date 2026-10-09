import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { INVITE_HOURS } from "@/lib/check/config";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { PersonView } from "@/lib/views";
import { logEvent } from "./events";
import { HttpError } from "./session";

type Link = typeof schema.links.$inferSelect;
type User = typeof schema.users.$inferSelect;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

export function newInviteCode() {
  const bytes = crypto.randomBytes(4);
  return "PB-" + [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

const codeExpiry = () => new Date(Date.now() + INVITE_HOURS * 3600_000);

export function toPersonView(l: Link): PersonView {
  return {
    id: l.id,
    name: l.name,
    relation: l.relation,
    phone: l.phone,
    status: l.status,
    inviteCode: l.inviteCode,
    codeExpiresAt: l.codeExpiresAt.toISOString(),
    codeExpired: l.status === "waiting" && l.codeExpiresAt.getTime() < Date.now(),
    earlyHeadsUp: l.earlyHeadsUp,
  };
}

export async function listPeople(db: Db, protectedId: string) {
  const rows = await db.query.links.findMany({ where: eq(schema.links.protectedId, protectedId), orderBy: asc(schema.links.createdAt) });
  return rows.map(toPersonView);
}

/** Linked family members of a protected user, with their user records. */
export async function linkedFamily(db: Db, protectedId: string) {
  const rows = await db.query.links.findMany({
    where: and(eq(schema.links.protectedId, protectedId), eq(schema.links.status, "linked")),
    orderBy: asc(schema.links.createdAt),
  });
  return rows.filter((l): l is Link & { familyId: string } => !!l.familyId);
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

export type PersonInput = { name: string; relation: string; phone: string; earlyHeadsUp: boolean };

export async function addPerson(db: Db, owner: User, input: PersonInput) {
  const [row] = await db
    .insert(schema.links)
    .values({ protectedId: owner.id, ...input, inviteCode: newInviteCode(), codeExpiresAt: codeExpiry() })
    .returning();
  await logEvent(db, owner.id, owner.name, "person_added", `${owner.name} added ${input.name} (${input.relation.toLowerCase()})`);
  return toPersonView(row);
}

export async function updatePerson(db: Db, owner: User, id: string, input: PersonInput) {
  const [row] = await db
    .update(schema.links)
    .set(input)
    .where(and(eq(schema.links.id, id), eq(schema.links.protectedId, owner.id)))
    .returning();
  if (!row) throw new HttpError(404, "That person was not found.");
  return toPersonView(row);
}

export async function removePerson(db: Db, owner: User, id: string) {
  const [row] = await db
    .delete(schema.links)
    .where(and(eq(schema.links.id, id), eq(schema.links.protectedId, owner.id)))
    .returning();
  if (!row) throw new HttpError(404, "That person was not found.");
  await logEvent(db, owner.id, owner.name, "person_removed", `${owner.name} removed ${row.name}`);
}

export async function resendCode(db: Db, owner: User, id: string) {
  const [row] = await db
    .update(schema.links)
    .set({ inviteCode: newInviteCode(), codeExpiresAt: codeExpiry() })
    .where(and(eq(schema.links.id, id), eq(schema.links.protectedId, owner.id), eq(schema.links.status, "waiting")))
    .returning();
  if (!row) throw new HttpError(404, "That invite was not found.");
  return toPersonView(row);
}

/** C1: a family member enters the code Mr Rao shared. */
export async function acceptInvite(db: Db, member: User, rawCode: string) {
  const code = rawCode.trim().toUpperCase().replace(/^PB-?/, "PB-");
  const link = await db.query.links.findFirst({ where: eq(schema.links.inviteCode, code) });
  if (!link || link.status !== "waiting" || link.codeExpiresAt.getTime() < Date.now()) {
    throw new HttpError(400, "That code did not work. Check each letter. Each code works once and ends in 24 hours.");
  }
  if (link.protectedId === member.id) throw new HttpError(400, "You cannot be your own trusted person.");
  await db
    .update(schema.links)
    .set({ familyId: member.id, status: "linked", linkedAt: new Date() })
    .where(eq(schema.links.id, link.id));
  await db.update(schema.users).set({ role: "family", name: member.name === "Guest" ? link.name : member.name }).where(eq(schema.users.id, member.id));
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, link.protectedId) });
  await logEvent(db, link.protectedId, link.name, "invite_accepted", `${link.name} accepted the invite and is now linked`);
  return { protectedName: owner?.name ?? "" };
}

/** Looks up the invite before accepting, so C1 can say who is asking. */
export async function previewInvite(db: Db, rawCode: string) {
  const code = rawCode.trim().toUpperCase().replace(/^PB-?/, "PB-");
  const link = await db.query.links.findFirst({ where: eq(schema.links.inviteCode, code) });
  if (!link || link.status !== "waiting" || link.codeExpiresAt.getTime() < Date.now()) return null;
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, link.protectedId) });
  return { code, protectedName: owner?.name ?? "", name: link.name, relation: link.relation };
}

export async function unlink(db: Db, member: User, linkId: string) {
  const [row] = await db
    .update(schema.links)
    .set({ familyId: null, status: "waiting", linkedAt: null, inviteCode: newInviteCode(), codeExpiresAt: codeExpiry() })
    .where(and(eq(schema.links.id, linkId), eq(schema.links.familyId, member.id)))
    .returning();
  if (!row) throw new HttpError(404, "Not linked.");
  await logEvent(db, row.protectedId, member.name, "unlinked", `${member.name} unlinked`);
}
