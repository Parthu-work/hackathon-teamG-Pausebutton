import { beforeAll, describe, expect, it } from "vitest";

// Phase 2 server flows against an in-memory Postgres (PGlite), no browser:
// F1 forward, F3 campaign radar, F4 disagreements, F6 live-call guard,
// F9 reported domains, F12 the ledger, F13 two keys.
process.env.PGLITE_DIR = "memory";

import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import examples from "@/data/examples.json";
import { createCallCheck, describeCall } from "./calls";
import { createCheck, getCheckView, setFamilyVerdict, sharedMessageFor } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { decideHold, holdMinutesOf, twoKeysFor } from "./holds";
import { familyLedger } from "./ledger";
import { disagreementsView, familiesView, mapClaudeFamily, stageOf } from "./ops";
import { liveBlockedDomains, listReports, reportDomain, reviewDomain } from "./reports";
import { campaignFor, campaignsView } from "./sightings";
import { familyState, lockView } from "./state";

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

describe("F1 · forward to Pause", () => {
  it("a forwarded scam gets the hold and the urgent alert, like a pasted one, and says where it came from", async () => {
    const { rao, arjun } = await users();
    const r = await createCheck(db, rao, { text: text("cbi"), source: "share", senderLabel: "WhatsApp" });
    expect(r.verdict).toBe("SCAM");
    expect(r.holdId).toBeTruthy();
    const view = await getCheckView(db, r.checkId, { ownerId: rao.id });
    expect(view.source).toBe("share");
    expect(view.senderLabel).toBe("WhatsApp");
    expect(view.alertedNames).toEqual(["Arjun", "Meera"]);
    const shared = await sharedMessageFor(db, arjun, r.checkId);
    expect(shared?.source).toBe("share");
  });
});

describe("F13 · two keys for large amounts", () => {
  it("two keys above Rs 50,000; the timer is the person's setting whatever the amount", () => {
    expect(twoKeysFor(80_000)).toBe(true);
    expect(twoKeysFor(1_850)).toBe(false);
    expect(holdMinutesOf({ holdMinutes: 30 })).toBe(30);
    expect(holdMinutesOf({ holdMinutes: 7 })).toBe(10);
  });

  it("the Rs 80,000 hold carries twoKeys and the default 10-minute window; one Block still stops it", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.hold).toMatchObject({ twoKeys: true, holdMinutes: 10 });
    const blocked = await decideHold(db, arjun, holdId!, "block", false);
    expect(blocked.status).toBe("blocked");
  });
});

describe("F6 · live-call guard", () => {
  it("any yes convicts the call, alerts the family at once, and the family reads what Papa told us", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const r = await createCallCheck(db, rao, { video: true, money: false, secrecy: false });
    expect(r.verdict).toBe("SCAM");
    expect(r.holdId).toBeNull();
    const view = await getCheckView(db, r.checkId, { ownerId: rao.id });
    expect(view).toMatchObject({ source: "call", hardRule: "live_call", family: "fake_officer", callAnswers: { video: true, money: false, secrecy: false } });
    expect(view.alertedNames).toEqual(["Arjun", "Meera"]);
    const fam = await familyState(db, arjun);
    expect(fam.alerts[0]).toMatchObject({ kind: "urgent", source: "call", holdId: null });
    const shared = await sharedMessageFor(db, arjun, r.checkId);
    expect(shared?.text).toBe(describeCall({ video: true, money: false, secrecy: false }));
    // The rules still mark the phrases in his account, so the family sees them highlighted.
    expect(shared!.signals.map((s) => s.type)).toContain("authority");
    expect(shared!.signals.map((s) => s.type)).toContain("fear");
    // The lock screen shows the call, with no payment to block.
    const lock = await lockView(db, arjun);
    expect(lock.alert?.source).toBe("call");
    expect(lock.hold).toBeNull();
  });

  it("three noes stay SUSPICIOUS and send nothing", async () => {
    const { rao, arjun } = await users();
    const before = (await familyState(db, arjun)).alerts.length;
    const r = await createCallCheck(db, rao, { video: false, money: false, secrecy: false });
    expect(r.verdict).toBe("SUSPICIOUS");
    expect((await familyState(db, arjun)).alerts.length).toBe(before);
  });

  it("money plus secrecy reads as the secrecy-and-payment pair in the text, with the live-call floor", async () => {
    const { rao } = await users();
    const r = await createCallCheck(db, rao, { video: false, money: true, secrecy: true });
    const view = await getCheckView(db, r.checkId, { ownerId: rao.id });
    expect(view.hardRule).toBe("live_call");
    expect(view.signals.map((s) => s.type)).toEqual(expect.arrayContaining(["payment", "secrecy"]));
  });
});

describe("F3 · campaign radar", () => {
  it("the demo's other households make the CBI message a campaign; a lone message is not one", async () => {
    await resetDemo(db);
    const { rao } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.campaign).not.toBeNull();
    expect(view.campaign!.households).toBeGreaterThanOrEqual(40);
    expect(view.campaign!.spreading).toBe(true);
    // A message nobody else got: no campaign card.
    const lone = await createCheck(db, rao, { text: "Sir this is the Pune cyber cell, stay on the line and do not tell your family, transfer Rs 999 now.", source: "paste" });
    expect((await getCheckView(db, lone.checkId, { ownerId: rao.id })).campaign).toBeNull();
    expect(await campaignFor(db, "nope", rao.id)).toBeNull();
  });

  it("the operator view groups by fingerprint and counts households, never text", async () => {
    const v = await campaignsView(db);
    expect(v.active).toBeGreaterThanOrEqual(4);
    expect(v.fastest?.last24h).toBeGreaterThanOrEqual(40);
    expect(v.rows[0]).not.toHaveProperty("text");
    expect(v.rows.every((r) => /^[0-9a-f]{32}$/.test(r.fingerprint))).toBe(true);
    expect(v.synthetic).toBeGreaterThan(100);
  });

  it("a safe message leaves no sighting", async () => {
    const { rao } = await users();
    const before = (await db.query.sightings.findMany({ where: eq(schema.sightings.householdKey, rao.id) })).length;
    await createCheck(db, rao, { text: text("bank"), source: "paste" });
    const after = (await db.query.sightings.findMany({ where: eq(schema.sightings.householdKey, rao.id) })).length;
    expect(after).toBe(before);
  });
});

describe("F9 · family-reported domains", () => {
  it("an alerted member reports the link; a reviewer blocks it; the next check sees it as a scam site", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("kyc"), source: "paste" }); // sbi-kyc-verify.in, a look-alike of SBI
    const before = await getCheckView(db, checkId, { member: arjun });
    expect(before.reportable).toMatchObject({ domain: "sbi-kyc-verify.in", status: "lookalike", protectedSite: false, reported: "none" });
    expect(before.reportable!.familiesProtected).toBeGreaterThanOrEqual(11); // the seeded parcel-duty-pay.top campaign

    const r = await reportDomain(db, arjun, checkId);
    expect(r.status).toBe("pending");
    expect((await reportDomain(db, arjun, checkId)).id).toBe(r.id); // reporting twice is one report
    expect((await getCheckView(db, checkId, { member: arjun })).reportable?.reported).toBe("pending");
    expect((await getCheckView(db, checkId, { member: meera })).reportable?.reported).toBe("none");

    const queue = await listReports(db);
    const row = queue.rows.find((x) => x.domain === "sbi-kyc-verify.in")!;
    // Another family (seeded) reported it first; Arjun is the "1 more".
    expect(row).toMatchObject({ reportedBy: "S. Mehta", otherReporters: 1, status: "pending", autoCheck: "lookalike", autoReason: "Looks like SBI" });
    expect(row.seenIn).toBeGreaterThanOrEqual(1);
    expect(queue.waiting).toBeGreaterThanOrEqual(2);

    await reviewDomain(db, row.id, "block");
    expect(await liveBlockedDomains(db)).toContain("sbi-kyc-verify.in");
    const again = await createCheck(db, rao, { text: "Please update at sbi-kyc-verify.in today.", source: "paste" });
    const view = await getCheckView(db, again.checkId, { ownerId: rao.id });
    expect(view.link?.status).toBe("blocked");
    expect(view.hardRule).toBe("bad_link");
    expect((await getCheckView(db, checkId, { member: meera })).reportable?.reported).toBe("blocked");
  });

  it("official sites are refused on sight and can never be blocked", async () => {
    const queue = await listReports(db);
    const sbi = queue.rows.find((x) => x.domain === "onlinesbi.com")!;
    expect(sbi).toMatchObject({ protectedSite: true, status: "rejected", autoCheck: "official" });
    await expect(reviewDomain(db, sbi.id, "block")).rejects.toThrow("never be blocked");
  });

  it("someone who was not alerted cannot report", async () => {
    const { rao } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" }); // SUSPICIOUS: nobody alerted
    const { arjun } = await users();
    await expect(reportDomain(db, arjun, checkId)).rejects.toThrow("alerted");
  });
});

describe("F12 · the household ledger", () => {
  it("counts this month's paused payments, the rupees kept, and who stopped what", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const first = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await decideHold(db, arjun, first.holdId!, "block", false);
    await createCheck(db, rao, { text: text("bank"), source: "paste" });
    const ledger = await familyLedger(db, meera);
    // 4 checks this month: the two seeded bank SMS (Papa's and Mummy's inboxes) plus the two above; 3 were fine.
    expect(ledger).toMatchObject({ paused: 1, heldAmount: 80_000, checked: 4, fine: 3 });
    expect(ledger.stopped[0]).toMatchObject({ amount: 80_000, by: "Arjun", owner: "Papa" });
    expect(ledger.fastest?.by).toBe("Arjun");
    expect(ledger.area.length).toBeGreaterThan(0);
    expect(ledger.area[0].households).toBeGreaterThanOrEqual(ledger.area[ledger.area.length - 1].households);
  });
});

describe("F4 · disagreement report", () => {
  it("a scam the family cleared counts as a money-level disagreement, by the stage that decided", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("kyc"), source: "paste" }); // hard rule: bad link
    await setFamilyVerdict(db, arjun, checkId, "not_scam");
    await setFamilyVerdict(db, meera, checkId, "not_scam");
    const v = await disagreementsView(db);
    expect(v.withAnswer).toBe(1);
    expect(v.scamApproved).toBe(1);
    expect(v.agreementPct).toBe(0);
    expect(v.stages[0]).toMatchObject({ stage: "Hard rule · look-alike or blocked link", checks: 1, overruled: 1 });
    expect(v.mostImportant[0]).toMatchObject({ by: "Meera" });
    expect(v.mostImportant[0]).not.toHaveProperty("text");
    expect(stageOf({ hardRule: null, decidedBy: "ai", verdict: "SCAM" })).toBe("Claude · raised from suspicious");
  });
});

describe("F7 · the scam family", () => {
  it("maps Claude's free words onto the enum and says when there is no Claude run", async () => {
    expect(mapClaudeFamily("fake courier fee")[0]).toBe("courier_fee");
    expect(mapClaudeFamily("digital arrest")[0]).toBe("fake_officer");
    expect(mapClaudeFamily("wrong UPI refund")[0]).toBe("wrong_upi_refund");
    expect(mapClaudeFamily(null)).toEqual([]);
    const v = await familiesView(db);
    expect(v.run).toBeNull();
    expect(v.enumSize).toBe(16);
    expect(v.unmatchedTestLabels).toEqual(["digital_arrest", "customs_parcel", "credential_otp"]);
  });
});
