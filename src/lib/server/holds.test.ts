import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// D2 · the payment hold time: every hold counts down the owner's setting
// (5, 10, 15, 30 or 60 minutes; 10 unless changed), which Mr Rao or a linked
// family member can change. A change moves only the next hold. Route handlers
// run for real against an in-memory Postgres; only Next's request scope is
// stood in for.
process.env.PGLITE_DIR = "memory";

const scope = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => scope.headers,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

import { and, eq } from "drizzle-orm";
import examples from "@/data/examples.json";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { PATCH as familySettings } from "@/app/api/family/settings/route";
import { PATCH as meSettings } from "@/app/api/me/settings/route";
import { createCheck, openPayment } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { decideHold, toHoldView } from "./holds";
import { sessionToken } from "./session";
import { familyState, raoState } from "./state";

const text = (id: string) => examples.find((e) => e.id === id)!.text;
const MINUTE = 60_000;
const ctx = { params: Promise.resolve({}) };
const patch = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
beforeEach(async () => {
  await resetDemo(db); // also puts the demo household's hold time back to 10 minutes
});
afterEach(() => {
  scope.headers = new Headers();
});

const users = async () => ({
  rao: (await personaUser(db, "rao"))!,
  mom: (await personaUser(db, "mom"))!,
  arjun: (await personaUser(db, "arjun"))!,
  meera: (await personaUser(db, "meera"))!,
});
const fresh = async (id: string) => (await db.query.users.findFirst({ where: eq(schema.users.id, id) }))!;
const holdRow = async (id: string) => (await db.query.holds.findFirst({ where: eq(schema.holds.id, id) }))!;
const lengthOf = (h: { createdAt: Date; expiresAt: Date }) => h.expiresAt.getTime() - h.createdAt.getTime();

/** Mr Rao pastes the CBI message (Rs 80,000): a SCAM with an amount, so a hold starts. */
async function cbiHold(rao: typeof schema.users.$inferSelect) {
  const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
  return holdRow(holdId!);
}

/** PATCH /api/me/settings as Mr Rao's phone. */
async function raoSets(userId: string, body: unknown) {
  scope.headers = new Headers({ "x-pb-rao": sessionToken(userId) });
  return meSettings(patch("/api/me/settings", body), ctx);
}

/** PATCH /api/family/settings as a family member's phone. */
async function familySets(userId: string, body: unknown) {
  scope.headers = new Headers({ "x-pb-family": sessionToken(userId) });
  return familySettings(patch("/api/family/settings", body), ctx);
}

describe("the hold's length", () => {
  it("is 10 minutes by default", async () => {
    const { rao } = await users();
    expect(rao.holdMinutes).toBe(10);
    const hold = await cbiHold(rao);
    expect(lengthOf(hold)).toBe(10 * MINUTE);
    expect((await toHoldView(db, hold)).holdMinutes).toBe(10);
  });

  it("follows Mr Rao's own setting: 30 minutes makes the next hold 30 minutes", async () => {
    const { rao } = await users();
    const res = await raoSets(rao.id, { holdMinutes: 30 });
    expect(res.status).toBe(200);
    const updated = await fresh(rao.id);
    expect(updated.holdMinutes).toBe(30);
    expect((await raoState(db, updated)).me.holdMinutes).toBe(30);

    const hold = await cbiHold(updated);
    expect(lengthOf(hold)).toBe(30 * MINUTE);
    expect((await toHoldView(db, hold)).holdMinutes).toBe(30);
    // The family's activity log says who changed it.
    const events = await db.query.events.findMany({ where: and(eq(schema.events.householdId, rao.id), eq(schema.events.type, "hold_minutes")) });
    expect(events.map((e) => e.message)).toEqual(["Mr Rao set the payment hold time to 30 minutes"]);
  });

  it("applies to a payment he opens himself too (pay anyway on a suspicious message)", async () => {
    const { rao } = await users();
    await raoSets(rao.id, { holdMinutes: 5 });
    const { checkId } = await createCheck(db, await fresh(rao.id), { text: text("courier"), source: "paste" });
    const { holdId } = await openPayment(db, await fresh(rao.id), checkId);
    expect(lengthOf(await holdRow(holdId))).toBe(5 * MINUTE);
  });

  it("a linked family member can set 15 for the person they protect, and the next hold is 15 minutes", async () => {
    const { rao, mom, arjun } = await users();
    const res = await familySets(arjun.id, { hold: { protectedId: rao.id, minutes: 15 } });
    expect(res.status).toBe(200);
    expect((await fresh(rao.id)).holdMinutes).toBe(15);
    expect((await fresh(mom.id)).holdMinutes).toBe(10); // only the person named
    expect((await fresh(arjun.id)).holdMinutes).toBe(10); // not his own row
    const papa = (await familyState(db, arjun)).people.find((p) => p.id === rao.id)!;
    expect(papa.holdMinutes).toBe(15);

    const hold = await cbiHold(await fresh(rao.id));
    expect(lengthOf(hold)).toBe(15 * MINUTE);
    const events = await db.query.events.findMany({ where: and(eq(schema.events.householdId, rao.id), eq(schema.events.type, "hold_minutes")) });
    expect(events.map((e) => e.message)).toEqual(["Arjun set Mr Rao's payment hold time to 15 minutes"]);

    // Setting the same value again changes nothing and logs nothing.
    expect((await familySets(arjun.id, { hold: { protectedId: rao.id, minutes: 15 } })).status).toBe(200);
    expect(await db.query.events.findMany({ where: and(eq(schema.events.householdId, rao.id), eq(schema.events.type, "hold_minutes")) })).toHaveLength(1);
  });
});

describe("who may change it, and to what", () => {
  it("refuses anything but 5, 10, 15, 30 or 60 minutes (7 is a 400) from Mr Rao's settings", async () => {
    const { rao } = await users();
    for (const holdMinutes of [7, 0, 120, 10.5, "15"]) {
      const res = await raoSets(rao.id, { holdMinutes });
      expect(res.status).toBe(400);
    }
    const res = await raoSets(rao.id, { holdMinutes: 7 });
    expect((await res.json()).error).toBe("Please pick 5, 10, 15, 30 or 60 minutes.");
    expect((await fresh(rao.id)).holdMinutes).toBe(10);
  });

  it("refuses 7 minutes from a family member's settings too (400)", async () => {
    const { rao, arjun } = await users();
    const res = await familySets(arjun.id, { hold: { protectedId: rao.id, minutes: 7 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Please pick 5, 10, 15, 30 or 60 minutes.");
    expect((await fresh(rao.id)).holdMinutes).toBe(10);
  });

  it("a family member who is not linked to him gets a 403 and nothing changes", async () => {
    const { rao } = await users();
    const [stranger] = await db.insert(schema.users).values({ name: "Stranger", phone: "+91 90000 55501", role: "family" }).returning();
    const res = await familySets(stranger.id, { hold: { protectedId: rao.id, minutes: 60 } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You are not linked to this person.");
    expect((await fresh(rao.id)).holdMinutes).toBe(10);
    await db.delete(schema.users).where(eq(schema.users.id, stranger.id));
  });

  it("a link that is not active (invited, not joined) does not count", async () => {
    const { rao, meera } = await users();
    await db.update(schema.links).set({ status: "waiting" }).where(and(eq(schema.links.protectedId, rao.id), eq(schema.links.familyId, meera.id)));
    const res = await familySets(meera.id, { hold: { protectedId: rao.id, minutes: 30 } });
    expect(res.status).toBe(403);
    expect((await fresh(rao.id)).holdMinutes).toBe(10);
  });

  it("needs a signed-in phone (401)", async () => {
    const { rao } = await users();
    expect((await meSettings(patch("/api/me/settings", { holdMinutes: 30 }), ctx)).status).toBe(401);
    expect((await familySettings(patch("/api/family/settings", { hold: { protectedId: rao.id, minutes: 30 } }), ctx)).status).toBe(401);
  });
});

describe("a hold already running", () => {
  it("keeps its time when the setting changes; only the next hold gets the new length", async () => {
    const { rao, arjun } = await users();
    const running = await cbiHold(rao);
    await raoSets(rao.id, { holdMinutes: 60 });
    await familySets(arjun.id, { hold: { protectedId: rao.id, minutes: 5 } });

    const after = await holdRow(running.id);
    expect(after.expiresAt.getTime()).toBe(running.expiresAt.getTime());
    expect((await toHoldView(db, after)).holdMinutes).toBe(10);
    const view = (await raoState(db, await fresh(rao.id))).activeHold!;
    expect(view.id).toBe(running.id);
    expect(view.expiresAt).toBe(running.expiresAt.toISOString());

    const next = await cbiHold(await fresh(rao.id));
    expect(lengthOf(next)).toBe(5 * MINUTE);
  });

  it("once its time runs out, refuses Approve and still takes Block", async () => {
    const { rao, arjun, meera } = await users();
    await raoSets(rao.id, { holdMinutes: 15 });
    const hold = await cbiHold(await fresh(rao.id));
    await db.update(schema.holds).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.holds.id, hold.id));

    await expect(decideHold(db, meera, hold.id, "approve", true)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Time ran out") });
    expect((await holdRow(hold.id)).status).toBe("pending"); // the money stays held
    const blocked = await decideHold(db, arjun, hold.id, "block", false);
    expect(blocked.status).toBe("blocked");
  });
});

describe("two keys above Rs 50,000", () => {
  it("are unchanged by the hold time: one Block stops it, release needs everyone", async () => {
    const { rao, arjun, meera } = await users();
    await raoSets(rao.id, { holdMinutes: 5 });
    const hold = await cbiHold(await fresh(rao.id));
    expect(hold.amount).toBe(80_000);
    const view = await toHoldView(db, hold);
    expect(view).toMatchObject({ twoKeys: true, holdMinutes: 5 });

    const half = await decideHold(db, arjun, hold.id, "approve", true);
    expect(half).toMatchObject({ status: "pending", approvedBy: ["Arjun"], waitingFor: ["Meera"] });
    const both = await decideHold(db, meera, hold.id, "approve", true);
    expect(both.status).toBe("approved");
    expect(both.approvedBy).toEqual(["Arjun", "Meera"]);
  });

  it("a small payment has the same timer and no two-key card", async () => {
    const { rao } = await users();
    await raoSets(rao.id, { holdMinutes: 30 });
    const { checkId } = await createCheck(db, await fresh(rao.id), { text: text("courier"), source: "paste" });
    const { holdId } = await openPayment(db, await fresh(rao.id), checkId);
    const view = await toHoldView(db, await holdRow(holdId));
    expect(view).toMatchObject({ amount: 1_850, twoKeys: false, holdMinutes: 30 });
  });
});
