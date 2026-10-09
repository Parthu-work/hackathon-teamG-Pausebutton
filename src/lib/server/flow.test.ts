import { beforeAll, describe, expect, it } from "vitest";

// The whole server flow against an in-memory Postgres (PGlite), no browser.
process.env.PGLITE_DIR = "memory";

import { getDb, type Db } from "@/lib/db";
import examples from "@/data/examples.json";
import { askFamily, createCheck, getCheckView, openPayment, setFamilyVerdict } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { decideHold, holdStatus } from "./holds";
import { acceptInvite } from "./people";
import { receiveNext } from "./sim";
import { familyState, raoState } from "./state";
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
    expect(fam.activeHold?.id).toBe(holdId);

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
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.familyVerdict).toBe("not_scam");
    expect(view.familyVerdictByName).toBe("Arjun");
    expect(view.advice[0].text).toBe("I checked. This one is fine.");
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

describe("simulated inbox", () => {
  it("a detected scam sends a quiet heads-up and shows the banner, with no hold", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    await receiveNext(db, rao); // the CBI WhatsApp
    const state = await raoState(db, rao);
    expect(state.banner).toMatchObject({ verdict: "SCAM", channel: "whatsapp" });
    expect(state.activeHold).toBeNull();
    const fam = await familyState(db, arjun);
    expect(fam.alerts.map((a) => a.kind)).toEqual(["headsup"]);
  });

  it("the text is never stored with the check", async () => {
    const { rao } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const row = (await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) }))!;
    expect(JSON.stringify(row)).not.toContain("A parcel in your name");
    expect(row.fingerprint).toMatch(/^[0-9a-f]{32}$/);
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
