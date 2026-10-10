import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// W5 · what is kept and for how long (docs/retention.md): watcher messages,
// the hourly purge, Delete my history and Delete my account. Route handlers
// run for real against an in-memory Postgres; only Next's request scope (and
// its cookie jar) is stood in for.
process.env.PGLITE_DIR = "memory";

const scope = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (scope.cookies.has(name) ? { name, value: scope.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void scope.cookies.set(name, value),
    delete: (name: string) => void scope.cookies.delete(name),
  }),
}));

import { and, eq } from "drizzle-orm";
import examples from "@/data/examples.json";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { POST as purgePost } from "@/app/api/cron/purge/route";
import { DELETE as familyAccountDelete } from "@/app/api/family/account/route";
import { DELETE as raoAccountDelete } from "@/app/api/me/account/route";
import { deleteAccount } from "./account";
import { createCheck, deleteHistory, getCheckView, listChecks, purgeSharedText, setFamilyVerdict, sharedMessageFor } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { holdTimeline } from "./events";
import { cancelHold, decideHold } from "./holds";
import { acceptInvite, addPerson } from "./people";
import { reportDomain } from "./reports";
import { purgeExpired, requireCron } from "./retention";
import { personBody } from "./schemas";
import { sessionToken } from "./session";
import { deliverMessage, listInbox, receiveNext } from "./sim";
import { familyState, raoState } from "./state";

const text = (id: string) => examples.find((e) => e.id === id)!.text;
const HOUR = 3600_000;
const ctx = { params: Promise.resolve({}) };
const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost${path}`, { method: init.method ?? "POST", headers: init.headers });

let db: Db;
beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
});
const savedSecret = process.env.CRON_SECRET;
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  scope.cookies.clear();
});

// A real (not demo) household: a protected person and the son who protects him.
let n = 0;
async function household() {
  n++;
  const phone = (k: number) => `9${String(810_000_000 + n * 10 + k)}`;
  const [papa] = await db.insert(schema.users).values({ name: `Papa ${n}`, phone: `+91 ${phone(1)}`, role: "protected" }).returning();
  const [son] = await db.insert(schema.users).values({ name: `Ravi ${n}`, phone: `+91 ${phone(2)}`, role: "family" }).returning();
  const person = await addPerson(db, papa, personBody.parse({ name: "Ravi", relation: "Son", phone: phone(2) }));
  await acceptInvite(db, son, person.inviteCode);
  return { papa, son, linkId: person.id };
}
const user = async (id: string) => db.query.users.findFirst({ where: eq(schema.users.id, id) });
const checkRow = async (id: string) => (await db.query.checks.findFirst({ where: eq(schema.checks.id, id) }))!;
const inboxRows = async (userId: string) => db.query.simMessages.findMany({ where: eq(schema.simMessages.userId, userId) });
const eventsOf = async (householdId: string) => db.query.events.findMany({ where: eq(schema.events.householdId, householdId) });
const backdate = async (checkId: string, hours: number) =>
  db.update(schema.checks).set({ createdAt: new Date(Date.now() - hours * HOUR) }).where(eq(schema.checks.id, checkId));

describe("messages from the Android watcher", () => {
  it("keep no text in the inbox: a scam's text lives on its check for 24 hours, a safe one's nowhere", async () => {
    const { papa, son } = await household();
    const safe = await deliverMessage(db, papa, { channel: "sms", sender: "HDFCBK", fromContact: false, text: text("bank") });
    const scam = await deliverMessage(db, papa, { channel: "whatsapp", sender: "+91 9XXXX XXXXX", fromContact: false, text: text("cbi") });

    const rows = await inboxRows(papa.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.text === null && !r.synthetic)).toBe(true);
    expect((await checkRow(safe.checkId!)).messageText).toBeNull();
    expect((await checkRow(scam.checkId!)).messageText).toBe(text("cbi"));

    // He sees the scam's text in his inbox while it is kept; the safe one shows none.
    const inbox = await listInbox(db, papa.id);
    expect(inbox.find((m) => m.checkId === scam.checkId)?.text).toBe(text("cbi"));
    expect(inbox.find((m) => m.checkId === safe.checkId)?.text).toBeNull();
    // The son got a heads-up and reads it from the check, not from the inbox row.
    const view = await getCheckView(db, scam.checkId!, { member: son });
    expect(view.simText).toBeNull();
    expect(view.messageText).toBe(text("cbi"));

    // Past 24 hours nobody can read it, even before the purge runs.
    await backdate(scam.checkId!, 25);
    expect((await getCheckView(db, scam.checkId!, { member: son })).messageText).toBeNull();
    expect(await sharedMessageFor(db, son, scam.checkId!)).toBeNull();
    expect((await listInbox(db, papa.id)).find((m) => m.checkId === scam.checkId)?.text).toBeNull();
    expect((await raoState(db, papa)).banner?.text ?? null).toBeNull();
  });

  it("a message that is not checked is not stored at all, not even who sent it", async () => {
    const { papa } = await household();
    const contact = await deliverMessage(db, papa, { channel: "sms", sender: "Meera (saved)", fromContact: true, text: "Papa, dinner at 8?" });
    expect(contact).toEqual({ id: null, checkId: null, status: "skipped", duplicate: false });
    await db.update(schema.users).set({ watchWhatsapp: false }).where(eq(schema.users.id, papa.id));
    const unwatched = await deliverMessage(db, { ...papa, watchWhatsapp: false }, { channel: "whatsapp", sender: "+91 90000 11111", fromContact: false, text: text("cbi") });
    expect(unwatched).toEqual({ id: null, checkId: null, status: "skipped", duplicate: false });

    expect(await inboxRows(papa.id)).toEqual([]);
    expect(await db.query.checks.findMany({ where: eq(schema.checks.userId, papa.id) })).toEqual([]);
    const log = (await eventsOf(papa.id)).map((e) => e.message).join("\n");
    expect(log).toContain("not checked");
    expect(log).not.toContain("Meera (saved)");
    expect(log).not.toContain("+91 90000 11111");
  });

  it("text left on a real inbox row from before is never shown, and the purge clears it", async () => {
    const { papa, son } = await household();
    const { checkId } = await createCheck(db, papa, { text: text("cbi"), source: "whatsapp", senderLabel: "+91 9XXXX XXXXX" });
    await db.insert(schema.simMessages).values({ userId: papa.id, channel: "whatsapp", sender: "+91 9XXXX XXXXX", text: text("cbi"), checkId });
    await backdate(checkId, 30);
    expect((await getCheckView(db, checkId, { member: son })).simText).toBeNull();
    expect((await listInbox(db, papa.id))[0].text).toBeNull();

    await purgeSharedText(db);
    expect((await inboxRows(papa.id))[0].text).toBeNull();
  });

  it("a message we could not check keeps its text until it is checked, 24 hours at most, and never shows it", async () => {
    const { papa } = await household();
    const row = (sender: string, status: "failed" | "received", hours: number) => ({
      userId: papa.id, channel: "sms" as const, sender, text: text("cbi"), status, attempts: 1, createdAt: new Date(Date.now() - hours * HOUR),
    });
    await db.insert(schema.simMessages).values([row("fresh-failed", "failed", 2), row("old-failed", "failed", 25), row("old-received", "received", 25), row("fresh-received", "received", 1)]);
    // Mr Rao's inbox never shows the kept text: it is there only to check the message.
    const before = await listInbox(db, papa.id);
    expect(before.every((m) => m.text === null)).toBe(true);
    expect(before.find((m) => m.sender === "fresh-failed")).toMatchObject({ status: "failed", verdict: null, canRetry: true });

    const counts = await purgeSharedText(db);
    expect(counts.inboxText).toBeGreaterThanOrEqual(2);
    const rows = await inboxRows(papa.id);
    const of = (sender: string) => rows.find((r) => r.sender === sender)!;
    expect(of("fresh-failed")).toMatchObject({ status: "failed", text: text("cbi") });
    expect(of("fresh-received")).toMatchObject({ status: "received", text: text("cbi") });
    // Past 24 hours the text goes; it stays "could not check", with nothing left to try again.
    expect(of("old-failed")).toMatchObject({ status: "failed", text: null });
    expect(of("old-received")).toMatchObject({ status: "failed", text: null, error: "expired" });
    const after = await listInbox(db, papa.id);
    expect(after.find((m) => m.sender === "old-failed")).toMatchObject({ status: "failed", canRetry: false, text: null, verdict: null });
    expect(after.find((m) => m.sender === "fresh-failed")?.canRetry).toBe(true);
  });

  it("made-up demo messages keep their text, and the purge leaves them alone", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const { id } = await receiveNext(db, rao);
    await db.update(schema.simMessages).set({ createdAt: new Date(Date.now() - 48 * HOUR) }).where(eq(schema.simMessages.id, id!));
    await purgeExpired(db);
    const row = (await db.query.simMessages.findFirst({ where: eq(schema.simMessages.id, id!) }))!;
    expect(row.synthetic).toBe(true);
    expect(row.text).toBeTruthy();
  });
});

describe("the hourly purge", () => {
  it("deletes message text past 24 hours and logs past 30 days, and nothing newer", async () => {
    const { papa, son } = await household();
    const old = await createCheck(db, papa, { text: text("cbi"), source: "paste" });
    const fresh = await createCheck(db, papa, { text: text("cbi"), source: "paste" });
    await backdate(old.checkId, 25);
    const longAgo = new Date(Date.now() - 31 * 24 * HOUR);
    await db.insert(schema.events).values({ householdId: papa.id, actor: "Check service", type: "verdict", message: "an old line", createdAt: longAgo });
    await db.insert(schema.pushDeliveries).values([
      { userId: son.id, tag: "old", endpoint: "https://push.example/old", status: "sent", createdAt: longAgo },
      { userId: son.id, tag: "new", endpoint: "https://push.example/new", status: "sent" },
    ]);
    const [, newRun] = await db
      .insert(schema.syncRuns)
      .values([{ startedAt: longAgo, finishedAt: longAgo }, { startedAt: new Date(), finishedAt: new Date() }])
      .returning();

    const counts = await purgeExpired(db);
    expect(counts.checkText).toBeGreaterThanOrEqual(1);
    expect(counts.events).toBeGreaterThanOrEqual(1);
    expect(counts.pushDeliveries).toBeGreaterThanOrEqual(1);
    expect(counts.syncRuns).toBe(1);
    expect((await db.query.syncRuns.findMany()).map((r) => r.id)).toEqual([newRun.id]);
    expect((await checkRow(old.checkId)).messageText).toBeNull();
    expect((await checkRow(fresh.checkId)).messageText).toBe(text("cbi"));
    const lines = (await eventsOf(papa.id)).map((e) => e.message);
    expect(lines).not.toContain("an old line");
    expect(lines.length).toBeGreaterThan(0);
    const tags = (await db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.userId, son.id) })).map((d) => d.tag);
    expect(tags).toContain("new");
    expect(tags).not.toContain("old");
  });

  it("every check still clears expired text first", async () => {
    const { papa } = await household();
    const old = await createCheck(db, papa, { text: text("cbi"), source: "paste" });
    await backdate(old.checkId, 25);
    await createCheck(db, papa, { text: text("bank"), source: "paste" });
    expect((await checkRow(old.checkId)).messageText).toBeNull();
  });

  it("runs only with the right CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    expect(() => requireCron(req("/api/cron/purge"))).toThrow("set CRON_SECRET");
    expect((await purgePost(req("/api/cron/purge"), ctx)).status).toBe(503);

    process.env.CRON_SECRET = "a-long-random-purge-key";
    expect((await purgePost(req("/api/cron/purge"), ctx)).status).toBe(401);
    expect((await purgePost(req("/api/cron/purge", { headers: { authorization: "Bearer nope" } }), ctx)).status).toBe(401);
    const ok = await purgePost(req("/api/cron/purge", { headers: { authorization: "Bearer a-long-random-purge-key" } }), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      checkText: expect.any(Number),
      inboxText: expect.any(Number),
      events: expect.any(Number),
      pushDeliveries: expect.any(Number),
      syncRuns: expect.any(Number),
      otpCodes: expect.any(Number),
    });
  });

  it("sweeps sign-in codes older than a day", async () => {
    const phone = "+91 98100 77001";
    const old = new Date(Date.now() - 25 * HOUR);
    await db.insert(schema.otpCodes).values([
      { phone, codeHash: "old", expiresAt: new Date(old.getTime() + 5 * 60_000), createdAt: old },
      { phone, codeHash: "new", expiresAt: new Date(Date.now() + 5 * 60_000) },
    ]);
    const counts = await purgeExpired(db);
    expect(counts.otpCodes).toBeGreaterThanOrEqual(1);
    const left = await db.query.otpCodes.findMany({ where: eq(schema.otpCodes.phone, phone) });
    expect(left.map((c) => c.codeHash)).toEqual(["new"]);
  });
});

describe("Delete my history", () => {
  it("removes his checks, inbox and activity log, and unlinks his sightings, but keeps a payment on hold", async () => {
    const { papa, son } = await household();
    const scam = await deliverMessage(db, papa, { channel: "whatsapp", sender: "+91 9XXXX XXXXX", fromContact: false, text: text("cbi") });
    const paused = await createCheck(db, papa, { text: text("cbi"), source: "paste" });
    expect(paused.holdId).toBeTruthy();
    expect((await db.query.sightings.findMany({ where: eq(schema.sightings.householdKey, papa.id) })).length).toBe(2);

    expect(await deleteHistory(db, papa)).toEqual({ kept: 1 });
    expect(await db.query.checks.findFirst({ where: eq(schema.checks.id, scam.checkId!) })).toBeUndefined();
    expect(await inboxRows(papa.id)).toEqual([]);
    // The household log keeps only the paused payment's timeline and the deletion itself.
    const log = await eventsOf(papa.id);
    expect(log.every((e) => e.holdId === paused.holdId || e.type === "history_deleted")).toBe(true);
    expect((await holdTimeline(db, paused.holdId!)).length).toBeGreaterThan(0);
    // Sightings still count, under one key that does not lead back to him.
    expect(await db.query.sightings.findMany({ where: eq(schema.sightings.householdKey, papa.id) })).toEqual([]);
    expect(await db.query.sightings.findMany({ where: eq(schema.sightings.fingerprint, (await checkRow(paused.checkId)).fingerprint) })).not.toEqual([]);
    // The family's Block still reaches the paused payment.
    expect((await decideHold(db, son, paused.holdId!, "block", false)).status).toBe("blocked");
  });
});

describe("Delete my account", () => {
  it("is refused while a payment is on hold, then deletes everything that is his", async () => {
    const { papa, son, linkId } = await household();
    const paused = await createCheck(db, papa, { text: text("cbi"), source: "paste" });
    await deliverMessage(db, papa, { channel: "whatsapp", sender: "+91 9XXXX XXXXX", fromContact: false, text: text("cbi") });
    await db.insert(schema.devices).values({ userId: papa.id, name: "Pixel", tokenHash: `hash-${papa.id}`, pairedAt: new Date() });
    await db.insert(schema.pushSubscriptions).values({ userId: papa.id, endpoint: `https://push.example/${papa.id}`, p256dh: "k", auth: "a" });
    const print = (await checkRow(paused.checkId)).fingerprint;

    await expect(deleteAccount(db, papa)).rejects.toMatchObject({ status: 409 });
    expect(await user(papa.id)).toBeTruthy();
    // The son cannot leave either while his father's payment is on hold.
    await expect(deleteAccount(db, son)).rejects.toMatchObject({ status: 409 });

    await cancelHold(db, papa, paused.holdId!);
    scope.cookies.set("pb_rao", sessionToken(papa.id));
    scope.cookies.set("pb_family", sessionToken(son.id)); // someone else on the same phone keeps their session
    const res = await raoAccountDelete(req("/api/me/account", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(scope.cookies.has("pb_rao")).toBe(false);
    expect(scope.cookies.get("pb_family")).toBe(sessionToken(son.id));

    expect(await user(papa.id)).toBeUndefined();
    for (const table of [schema.checks, schema.holds, schema.simMessages, schema.devices, schema.pushSubscriptions] as const) {
      expect(await db.select().from(table).where(eq(table.userId, papa.id))).toEqual([]);
    }
    expect(await db.query.links.findFirst({ where: eq(schema.links.id, linkId) })).toBeUndefined();
    expect(await eventsOf(papa.id)).toEqual([]);
    expect(await db.query.sightings.findMany({ where: eq(schema.sightings.householdKey, papa.id) })).toEqual([]);
    expect(await db.query.sightings.findMany({ where: eq(schema.sightings.fingerprint, print) })).not.toEqual([]);
    // The son's own account is untouched; he simply protects nobody now.
    expect(await user(son.id)).toBeTruthy();
    expect((await familyState(db, son)).people).toEqual([]);
  });

  it("a family member who leaves is unlinked everywhere; their reports stay without their name", async () => {
    const { papa, son, linkId } = await household();
    const { checkId } = await createCheck(db, papa, { text: text("kyc"), source: "paste" });
    await reportDomain(db, son, checkId);
    const before = (await db.query.links.findFirst({ where: eq(schema.links.id, linkId) }))!;

    scope.cookies.set("pb_family", sessionToken(son.id));
    const res = await familyAccountDelete(req("/api/family/account", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(scope.cookies.has("pb_family")).toBe(false);
    expect(await user(son.id)).toBeUndefined();

    const link = (await db.query.links.findFirst({ where: eq(schema.links.id, linkId) }))!;
    expect(link).toMatchObject({ familyId: null, status: "waiting", name: "Ravi" });
    expect(link.inviteCode).not.toBe(before.inviteCode);
    expect((await raoState(db, papa)).helperNames).toEqual([]);
    expect((await eventsOf(papa.id)).at(-1)?.message).toBe("Ravi deleted their account and no longer gets alerts");

    const reports = await db.query.reportedDomains.findMany({ where: eq(schema.reportedDomains.checkId, checkId) });
    expect(reports.length).toBe(1);
    expect(reports[0]).toMatchObject({ reportedById: null, reportedByName: "" });
  });

  it("a verdict a deleted member settled stays settled for the others", async () => {
    const { papa, son } = await household();
    const [daughter] = await db.insert(schema.users).values({ name: "Asha", phone: "+91 97000 55511", role: "family" }).returning();
    const p = await addPerson(db, papa, personBody.parse({ name: "Asha", relation: "Daughter", phone: "9700055511" }));
    await acceptInvite(db, daughter, p.inviteCode);
    const scam = await deliverMessage(db, papa, { channel: "whatsapp", sender: "+91 9XXXX XXXXX", fromContact: false, text: text("cbi") });
    expect((await familyState(db, daughter)).alerts.map((a) => a.kind)).toEqual(["headsup"]);
    await setFamilyVerdict(db, son, scam.checkId!, "scam");
    await deleteAccount(db, son);

    const view = await getCheckView(db, scam.checkId!, { member: daughter });
    expect(view.familyVerdict).toBe("scam");
    expect(view.canAnswer).toBe(false);
    expect(view.waitingFor).toEqual([]);
    expect((await listChecks(db, papa.id))[0].verdict).toBe("SCAM");
  });

  it("the shared demo personas cannot be deleted", async () => {
    const rao = (await personaUser(db, "rao"))!;
    await expect(deleteAccount(db, rao)).rejects.toMatchObject({ status: 403 });
    scope.cookies.set("pb_family", sessionToken((await personaUser(db, "arjun"))!.id));
    expect((await familyAccountDelete(req("/api/family/account", { method: "DELETE" }), ctx)).status).toBe(403);
    expect(await personaUser(db, "arjun")).toBeTruthy();
    expect(await db.query.links.findMany({ where: and(eq(schema.links.protectedId, rao.id), eq(schema.links.status, "linked")) })).not.toEqual([]);
  });
});
