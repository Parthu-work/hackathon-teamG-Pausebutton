import { beforeAll, describe, expect, it } from "vitest";

// The whole server flow against an in-memory Postgres (PGlite), no browser.
process.env.PGLITE_DIR = "memory";

import { getDb, type Db } from "@/lib/db";
import examples from "@/data/examples.json";
import { askFamily, createCheck, deleteHistory, getCheckView, listChecks, openPayment, purgeSharedText, setFamilyVerdict, sharedMessageFor } from "./checks";
import { ensureDemoHousehold, personaUser, resetDemo } from "./demo";
import { addAdvice, cancelHold, decideHold, holdStatus, toHoldView } from "./holds";
import { acceptInvite, addPerson, newInviteCode } from "./people";
import { personBody } from "./schemas";
import { listInbox, receiveNext } from "./sim";
import { familyActivity, familyState, raoState, startOfToday } from "./state";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const text = (id: string) => examples.find((e) => e.id === id)!.text;
let db: Db;
const users = async () => ({
  rao: (await personaUser(db, "rao"))!,
  arjun: (await personaUser(db, "arjun"))!,
  meera: (await personaUser(db, "meera"))!,
});

beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
});

describe("pasted scam → hold → family decides", () => {
  it("holds the money, alerts both linked people, and the first decision wins", async () => {
    const { rao, arjun, meera } = await users();
    const { checkId, holdId, verdict } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect(verdict).toBe("SCAM");
    expect(holdId).toBeTruthy();

    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.alertedNames).toEqual(["Arjun", "Meera"]);
    expect(view.hold?.amount).toBe(80000);
    expect(view.hold?.status).toBe("pending");

    const fam = await familyState(db, arjun);
    expect(fam.alerts[0]).toMatchObject({ kind: "urgent", holdId, otherRecipients: ["Meera"] });
    expect(fam.people[0].activeHold?.id).toBe(holdId);

    await expect(decideHold(db, arjun, holdId!, "approve", false)).rejects.toThrow("second confirm");
    const blocked = await decideHold(db, arjun, holdId!, "block", false);
    expect(blocked.status).toBe("blocked");
    await expect(decideHold(db, meera, holdId!, "approve", true)).rejects.toThrow("Arjun already blocked");

    const state = await raoState(db, rao);
    expect(state.outcome?.status).toBe("blocked");
    expect(state.activeHold).toBeNull();
    expect((await familyState(db, arjun)).alerts).toEqual([]);
  });

  it("a hold past 10 minutes reads as expired but still holds the money", async () => {
    const { rao } = await users();
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await db.update(schema.holds).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.holds.id, holdId!));
    const hold = (await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId!) }))!;
    expect(hold.status).toBe("pending");
    expect(holdStatus(hold)).toBe("expired");
  });
});

describe("suspicious → Ask Arjun → not a scam", () => {
  it("sends an ask, and the family answer reaches Mr Rao", async () => {
    const { rao, arjun } = await users();
    const { checkId, holdId, verdict } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    expect(verdict).toBe("SUSPICIOUS");
    expect(holdId).toBeNull();
    await askFamily(db, rao, checkId);
    expect((await familyState(db, arjun)).alerts.some((a) => a.kind === "ask" && a.checkId === checkId)).toBe(true);
    await setFamilyVerdict(db, arjun, checkId, "not_scam", "I checked. This one is fine.");
    const waiting = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(waiting.familyVerdict).toBeNull(); // Meera was asked too
    expect(waiting.waitingFor).toEqual(["Meera"]);
    const { meera } = await users();
    await setFamilyVerdict(db, meera, checkId, "not_scam");
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.familyVerdict).toBe("not_scam");
    expect(view.familyVerdictByName).toBe("Arjun and Meera");
    expect(view.advice.map((a) => a.text)).toContain("I checked. This one is fine.");
  });

  it("paying anyway locks the payment and alerts family", async () => {
    const { rao, arjun } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    const first = await openPayment(db, rao, checkId);
    const again = await openPayment(db, rao, checkId);
    expect(again.holdId).toBe(first.holdId);
    const fam = await familyState(db, arjun);
    expect(fam.alerts.some((a) => a.kind === "urgent" && a.holdId === first.holdId)).toBe(true);
  });
});

describe("two trusted people: one scam settles it, safe needs everyone", () => {
  it('"not a scam" from one person waits for the other; from both it shows SAFE', async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("kyc"), source: "paste" }); // SCAM, no amount → no hold
    await setFamilyVerdict(db, arjun, checkId, "not_scam", "I checked. This one is fine.");
    const half = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(half.finalVerdict).toBe("SCAM");
    expect(half.answers.map((a) => [a.name, a.verdict])).toEqual([["Arjun", "not_scam"]]);
    expect(half.waitingFor).toEqual(["Meera"]);
    expect((await getCheckView(db, checkId, { member: meera })).canAnswer).toBe(true);
    expect((await getCheckView(db, checkId, { member: arjun })).canAnswer).toBe(false);

    await setFamilyVerdict(db, meera, checkId, "not_scam");
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.verdict).toBe("SCAM");
    expect(view.finalVerdict).toBe("SAFE");
    expect(view.familyVerdictByName).toBe("Arjun and Meera");
    const row = (await listChecks(db, rao.id)).find((r) => r.id === checkId)!;
    expect(row).toMatchObject({ verdict: "SAFE", checkedBy: "Arjun and Meera" });
    await expect(setFamilyVerdict(db, arjun, checkId, "scam")).rejects.toThrow("already decided");
  });

  it('one "it\'s a scam" settles it, even after the other said fine', async () => {
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    await askFamily(db, rao, checkId);
    await setFamilyVerdict(db, arjun, checkId, "not_scam");
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).finalVerdict).toBe("SUSPICIOUS");
    await setFamilyVerdict(db, meera, checkId, "scam");
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.finalVerdict).toBe("SCAM");
    expect(view.familyVerdictByName).toBe("Meera");
  });

  it("a payment: one Block blocks it; release needs everyone to approve", async () => {
    const { rao, arjun, meera } = await users();
    const first = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await expect(setFamilyVerdict(db, arjun, first.checkId, "not_scam")).rejects.toThrow("Block or approve");
    const half = await decideHold(db, arjun, first.holdId!, "approve", true);
    expect(half.status).toBe("pending");
    expect(half.approvedBy).toEqual(["Arjun"]);
    expect(half.waitingFor).toEqual(["Meera"]);
    const done = await decideHold(db, meera, first.holdId!, "approve", true);
    expect(done.status).toBe("approved");
    expect(done.decidedByName).toBe("Arjun and Meera");
    expect((await getCheckView(db, first.checkId, { ownerId: rao.id })).finalVerdict).toBe("SAFE");

    const second = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await decideHold(db, arjun, second.holdId!, "approve", true);
    const blocked = await decideHold(db, meera, second.holdId!, "block", false);
    expect(blocked.status).toBe("blocked");
    expect(blocked.decidedByName).toBe("Meera");
    expect((await getCheckView(db, second.checkId, { ownerId: rao.id })).finalVerdict).toBe("SCAM");
  });

  it("someone who was not alerted cannot say it is safe", async () => {
    const { rao } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("kyc"), source: "paste" });
    const [ravi] = await db.insert(schema.users).values({ name: "Ravi", phone: "+91 98400 33344" }).returning();
    await acceptInvite(db, ravi, "PB-7H3D");
    await expect(setFamilyVerdict(db, ravi, checkId, "not_scam")).rejects.toThrow("Only the people who were alerted");
    expect((await getCheckView(db, checkId, { member: ravi })).canAnswer).toBe(false);
  });
});

describe("simulated inbox", () => {
  it("a detected scam sends a quiet heads-up and shows the banner, with no hold", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    await receiveNext(db, rao); // the CBI WhatsApp
    const state = await raoState(db, rao);
    expect(state.banner).toMatchObject({ verdict: "SCAM", channel: "whatsapp", status: "checked" });
    expect(state.activeHold).toBeNull();
    const fam = await familyState(db, arjun);
    expect(fam.alerts.map((a) => a.kind)).toEqual(["headsup"]);
    // Demo messages keep their text; one from a saved contact is skipped, never "could not check".
    const inbox = await listInbox(db, rao.id);
    expect(inbox.every((m) => m.text && (m.status === "checked" ? m.checkId : m.status === "skipped" && !m.checkId))).toBe(true);
    expect(inbox.find((m) => m.fromContact)).toMatchObject({ status: "skipped", verdict: "SKIPPED", canRetry: false });
  });
});

describe("the message family reads", () => {
  it("is kept for a scam, readable by alerted family only, and never for a safe message", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const row = (await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) }))!;
    expect(row.messageText).toBe(text("cbi"));
    expect(row.fingerprint).toMatch(/^[0-9a-f]{32}$/);

    // Arjun was alerted: he reads the exact message, with offsets that still point at the phrases.
    const shared = await sharedMessageFor(db, arjun, checkId);
    expect(shared?.text).toBe(text("cbi"));
    const fear = shared!.signals.find((s) => s.type === "fear")!;
    expect(shared!.text.slice(fear.start, fear.end)).toBe("illegal items");

    // Someone linked later, who was never alerted, does not.
    const [ravi] = await db.insert(schema.users).values({ name: "Ravi", phone: "+91 98400 22233" }).returning();
    await acceptInvite(db, ravi, "PB-7H3D");
    expect(await sharedMessageFor(db, ravi, checkId)).toBeNull();
    expect((await getCheckView(db, checkId, { member: ravi })).messageText).toBeNull();

    // A safe message's text is not kept.
    const safe = await createCheck(db, rao, { text: text("bank"), source: "paste" });
    const safeRow = (await db.query.checks.findFirst({ where: eq(schema.checks.id, safe.checkId) }))!;
    expect(safeRow.messageText).toBeNull();
  });

  it('"Ask Arjun anyway" on a safe message shares the text, but only the same message', async () => {
    const { rao, arjun } = await users();
    const safe = await createCheck(db, rao, { text: text("bank"), source: "paste" });
    await askFamily(db, rao, safe.checkId, "Something else entirely");
    expect((await db.query.checks.findFirst({ where: eq(schema.checks.id, safe.checkId) }))!.messageText).toBeNull();

    const again = await createCheck(db, rao, { text: text("bank"), source: "paste" });
    await askFamily(db, rao, again.checkId, text("bank"));
    expect((await sharedMessageFor(db, arjun, again.checkId))?.text).toBe(text("bank"));
  });

  it("is deleted after 24 hours", async () => {
    const { rao, arjun } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await db.update(schema.checks).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.checks.id, checkId));
    expect(await sharedMessageFor(db, arjun, checkId)).toBeNull();
    await purgeSharedText(db);
    expect((await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) }))!.messageText).toBeNull();
  });
});

describe("demo phone numbers", () => {
  it("follow DEMO_*_PHONE so the Call buttons ring real teammates", async () => {
    process.env.DEMO_ARJUN_PHONE = "90000 55555";
    await ensureDemoHousehold(db);
    const { rao, arjun } = await users();
    expect(arjun.phone).toBe("+91 90000 55555");
    const link = (await raoState(db, rao)).people.find((p) => p.name === "Arjun")!;
    expect(link.phone).toBe("+91 90000 55555");
    delete process.env.DEMO_ARJUN_PHONE;
    await ensureDemoHousehold(db);
    expect((await users()).arjun.phone).toBe("+91 91234 56789");
  });
});

describe("one family member, two protected people", () => {
  it("Arjun's phone lists Papa and Mummy, and says whose message an alert is about", async () => {
    await resetDemo(db);
    const { arjun } = await users();
    const mom = (await personaUser(db, "mom"))!;
    const fam = await familyState(db, arjun);
    expect(fam.people.map((p) => [p.name, p.callName, p.relation])).toEqual([
      ["Mr Rao", "Papa", "Son"],
      ["Mrs Rao", "Mummy", "Son"],
    ]);

    const { checkId, holdId } = await createCheck(db, mom, { text: text("cbi"), source: "paste" });
    const after = await familyState(db, arjun);
    expect(after.alerts[0]).toMatchObject({ checkId, holdId, owner: { name: "Mrs Rao", callName: "Mummy" } });
    const papa = after.people.find((p) => p.callName === "Papa")!;
    const mummy = after.people.find((p) => p.callName === "Mummy")!;
    expect(papa.activeHold).toBeNull();
    expect(mummy.activeHold?.id).toBe(holdId);
    expect(mummy.activeHold?.owner.callName).toBe("Mummy");
    expect((await getCheckView(db, checkId, { member: arjun })).owner.callName).toBe("Mummy");

    const activity = await familyActivity(db, arjun);
    expect(activity.some((i) => i.owner.callName === "Mummy" && i.checkId === checkId)).toBe(true);
  });

  it("a friend sees the name, a child sees the nickname", async () => {
    const { rao } = await users();
    const [ravi] = await db.insert(schema.users).values({ name: "Ravi", phone: "+91 98400 44455" }).returning();
    await acceptInvite(db, ravi, "PB-7H3D"); // Dinesh's code: relation Friend, to Mr Rao
    const fam = await familyState(db, ravi);
    expect(fam.people.map((p) => p.callName)).toEqual(["Mr Rao"]);
    const { checkId } = await createCheck(db, rao, { text: text("kyc"), source: "paste" });
    expect((await getCheckView(db, checkId, { member: ravi })).owner.callName).toBe("Mr Rao");
  });

  it("a family member can link a second person with another code", async () => {
    await resetDemo(db);
    const [ravi] = await db.insert(schema.users).values({ name: "Ravi", phone: "+91 98400 55566" }).returning();
    await acceptInvite(db, ravi, "PB-7H3D");
    expect((await familyState(db, ravi)).people).toHaveLength(1);
    // Mrs Rao invites Ravi too (a fresh code on her side).
    const mom = (await personaUser(db, "mom"))!;
    const person = await addPerson(db, mom, { name: "Ravi", relation: "Friend", phone: "+91 98400 55566", earlyHeadsUp: true });
    await acceptInvite(db, ravi, person.inviteCode);
    expect((await familyState(db, ravi)).people.map((p) => p.name)).toEqual(["Mr Rao", "Mrs Rao"]);
  });
});

describe("invites", () => {
  it("a waiting code links a new family member once", async () => {
    await resetDemo(db);
    const [ravi] = await db.insert(schema.users).values({ name: "Ravi", phone: "+91 98400 11122" }).returning();
    await expect(acceptInvite(db, ravi, "PB-XXXX")).rejects.toThrow("did not work");
    await expect(acceptInvite(db, ravi, "pb-7h3d")).resolves.toEqual({ protectedName: "Mr Rao" });
    await expect(acceptInvite(db, ravi, "PB-7H3D")).rejects.toThrow("did not work");
  });
});

describe("family decisions stick", () => {
  it("a later \"not a scam\" never undoes \"it's a scam\"", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    await askFamily(db, rao, checkId);
    await setFamilyVerdict(db, arjun, checkId, "scam", "It is a scam. Do not pay or reply.");
    await expect(setFamilyVerdict(db, meera, checkId, "not_scam", "I checked. This one is fine.")).rejects.toThrow("already decided: a scam");
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.familyVerdict).toBe("scam");
    expect(view.familyVerdictByName).toBe("Arjun");
    expect(view.advice.map((a) => a.fromName)).toEqual(["Arjun"]);
  });

  it("an expired hold can be blocked but never approved", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await db.update(schema.holds).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.holds.id, holdId!));
    await expect(decideHold(db, arjun, holdId!, "approve", true)).rejects.toThrow("Time ran out");
    expect((await decideHold(db, arjun, holdId!, "block", false)).status).toBe("blocked");
  });

  it("after a block, paying anyway is refused and nobody is alerted again", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await decideHold(db, arjun, holdId!, "block", false);
    const alertCount = async () => (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).length;
    const before = await alertCount();
    await expect(openPayment(db, rao, checkId)).rejects.toThrow("Arjun blocked this payment");
    expect(await alertCount()).toBe(before);
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).hold?.status).toBe("blocked");
  });

  it("after family says it is a scam, paying anyway is refused even with no hold yet", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" }); // SUSPICIOUS, Rs 1,850, no hold
    await askFamily(db, rao, checkId);
    await setFamilyVerdict(db, arjun, checkId, "scam");
    await expect(openPayment(db, rao, checkId)).rejects.toThrow("Arjun said this is a scam");
    expect(await db.query.holds.findFirst({ where: eq(schema.holds.checkId, checkId) })).toBeUndefined();
  });

  it("after Mr Rao cancels his own hold, paying anyway starts a new one and alerts family once", async () => {
    await resetDemo(db);
    const { rao } = await users();
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await cancelHold(db, rao, holdId!);
    const alertCount = async () => (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).length;
    const before = await alertCount();
    const again = await openPayment(db, rao, checkId);
    expect(again.holdId).not.toBe(holdId);
    expect(again.status).toBe("pending");
    expect(await alertCount()).toBe(before + 2); // Arjun and Meera, once each
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).hold?.status).toBe("pending");
  });

  it("Mr Rao sees the first advice, not the latest", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await addAdvice(db, arjun, { holdId: holdId! }, "Papa, hang up.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await addAdvice(db, meera, { holdId: holdId! }, "Stay on the phone with me.");
    const hold = (await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId!) }))!;
    expect((await toHoldView(db, hold)).advice[0]).toMatchObject({ fromName: "Arjun", text: "Papa, hang up." });
  });
});

describe("history and invites", () => {
  it("deleting history keeps a payment that is still on hold", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const safe = await createCheck(db, rao, { text: text("bank"), source: "paste" });
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect(await deleteHistory(db, rao)).toEqual({ kept: 1 });
    expect(await db.query.checks.findFirst({ where: eq(schema.checks.id, safe.checkId) })).toBeUndefined();
    expect((await decideHold(db, arjun, holdId!, "block", false)).status).toBe("blocked");
  });

  it("a family member cannot link to the same person twice", async () => {
    await resetDemo(db);
    const { arjun } = await users();
    await expect(acceptInvite(db, arjun, "PB-7H3D")).rejects.toThrow("already linked to Mr Rao");
  });

  it("two people sending one code at once: only one joins", async () => {
    await resetDemo(db);
    const [asha] = await db.insert(schema.users).values({ name: "Asha", phone: "+91 98400 77788" }).returning();
    const [bala] = await db.insert(schema.users).values({ name: "Bala", phone: "+91 98400 66677" }).returning();
    const results = await Promise.allSettled([acceptInvite(db, asha, "PB-7H3D"), acceptInvite(db, bala, "PB-7H3D")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const winner = results[0].status === "fulfilled" ? asha : bala;
    const link = await db.query.links.findFirst({ where: eq(schema.links.inviteCode, "PB-7H3D") });
    expect(link?.familyId).toBe(winner.id);
  });
});

describe("people, codes and days", () => {
  it("trusted people need a real mobile number, once, and not his own", async () => {
    await resetDemo(db);
    const { rao } = await users();
    expect(personBody.safeParse({ name: "Ravi", relation: "Friend", phone: "12345" }).success).toBe(false);
    expect(personBody.parse({ name: "Ravi", relation: "Friend", phone: "098400-55566" }).phone).toBe("+91 98400 55566");
    const arjunAgain = { name: "Arjun 2", relation: "Son", phone: "+91 91234 56789", earlyHeadsUp: true };
    await expect(addPerson(db, rao, arjunAgain)).rejects.toThrow("Arjun already has this number");
    await expect(addPerson(db, rao, { ...arjunAgain, phone: rao.phone })).rejects.toThrow("your own number");
  });

  it("new invite codes are six characters", () => {
    expect(newInviteCode()).toMatch(/^PB-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("today starts at midnight in India, whatever the server's time zone", () => {
    expect(startOfToday(Date.parse("2026-10-09T20:00:00Z")).toISOString()).toBe("2026-10-09T18:30:00.000Z"); // 01:30 IST on the 10th
    expect(startOfToday(Date.parse("2026-10-09T10:00:00Z")).toISOString()).toBe("2026-10-08T18:30:00.000Z"); // 15:30 IST on the 9th
  });
});
