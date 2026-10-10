import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Step 5, server side: a watcher message is checked exactly once however
// often the phone posts it; a failed check is visible and the 30-minute sync
// job tries it again; an unconfirmed scam alert is pushed once more; a quiet
// phone is flagged. Against an in-memory Postgres, with the push service
// mocked and the checker able to fail on demand. Route handlers run for real.
process.env.PGLITE_DIR = "memory";
process.env.VAPID_PUBLIC_KEY = "public-test-key";
process.env.VAPID_PRIVATE_KEY = "private-test-key";

type Send = (subscription: { endpoint: string }, payload: string, options?: unknown) => Promise<unknown>;
const sendNotification = vi.hoisted(() => vi.fn<Send>(async () => ({ statusCode: 201 })));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  return { default: { setVapidDetails: vi.fn(), sendNotification }, WebPushError };
});

// The checker, able to fail (or take its time) on demand.
const checker = vi.hoisted(() => ({ failures: 0, delayMs: 0 }));
vi.mock("@/lib/check/pipeline", async (orig) => {
  const real = await orig<typeof import("@/lib/check/pipeline")>();
  return {
    ...real,
    checkMessage: async (...args: Parameters<typeof real.checkMessage>) => {
      if (checker.delayMs) await new Promise((r) => setTimeout(r, checker.delayMs));
      if (checker.failures > 0) {
        checker.failures--;
        throw Object.assign(new Error("The model is not answering"), { name: "ModelDown" });
      }
      return real.checkMessage(...args);
    },
  };
});

// What happens after a check is stored (here: Mr Rao's own notification), able to fail on demand.
const followUp = vi.hoisted(() => ({ fail: false }));
vi.mock("./notify", async (orig) => {
  const real = await orig<typeof import("./notify")>();
  return {
    ...real,
    notifyOwnerOfMessage: async (...args: Parameters<typeof real.notifyOwnerOfMessage>) => {
      if (followUp.fail) throw Object.assign(new Error("The push service is down"), { name: "PushDown" });
      return real.notifyOwnerOfMessage(...args);
    },
  };
});

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

import { and, eq, inArray } from "drizzle-orm";
import examples from "@/data/examples.json";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { POST as cronSync } from "@/app/api/cron/sync/route";
import { POST as inboxPost } from "@/app/api/device/inbox/route";
import { POST as statusPost } from "@/app/api/device/status/route";
import { POST as retryPost } from "@/app/api/me/inbox/[id]/retry/route";
import { GET as syncHealthGet } from "@/app/api/ops/sync-health/route";
import { askFamily } from "./checks";
import { resetDemo } from "./demo";
import { createPairing, deviceByToken, listDevices, pairDevice } from "./devices";
import { acceptInvite, addPerson } from "./people";
import { recordReceipt, saveSubscription } from "./push";
import { personBody } from "./schemas";
import { sessionToken } from "./session";
import { latestBanner, listInbox, retryMessage } from "./sim";
import { familyState } from "./state";
import { MAX_ATTEMPTS, runSync } from "./sync";

const text = (id: string) => examples.find((e) => e.id === id)!.text;
const SENDER = "+91 98765 00000";
const ctx = { params: Promise.resolve({}) };
const MINUTE = 60_000;

let db: Db;
const logged: string[] = [];
beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
  // Every log line, to prove none carries a message or its sender.
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  }
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  sendNotification.mockClear();
  checker.failures = 0;
  checker.delayMs = 0;
  followUp.fail = false;
  scope.cookies.clear();
});

// A real household: Papa, his son and daughter (each with one phone for alerts), and Papa's Android phone.
let n = 0;
async function household() {
  n++;
  const phone = (k: number) => `9${String(820_000_000 + n * 10 + k)}`;
  const [papa] = await db.insert(schema.users).values({ name: `Papa ${n}`, phone: `+91 ${phone(1)}`, role: "protected" }).returning();
  const family = [];
  for (const [k, name, relation] of [[2, "Ravi", "Son"], [3, "Asha", "Daughter"]] as const) {
    const [member] = await db.insert(schema.users).values({ name: `${name} ${n}`, phone: `+91 ${phone(k)}`, role: "family" }).returning();
    const person = await addPerson(db, papa, personBody.parse({ name, relation, phone: phone(k) }));
    await acceptInvite(db, member, person.inviteCode);
    await saveSubscription(db, member.id, { endpoint: `https://push.example.test/${member.id}`, keys: { p256dh: "p", auth: "a" } }, "test");
    family.push(member);
  }
  const pairing = await createPairing(db, papa, "https://pause.example.com");
  const { token } = await pairDevice(db, pairing.code, "Pixel 7");
  return { papa, son: family[0], daughter: family[1], token };
}

const inboxRequest = (token: string, body: Record<string, unknown>, key?: string) =>
  new Request("http://localhost/api/device/inbox", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body),
  });
const watcherPost = async (token: string, msg: { text: string; channel?: "sms" | "whatsapp" }, key?: string) => {
  const res = await inboxPost(inboxRequest(token, { channel: msg.channel ?? "whatsapp", sender: SENDER, fromContact: false, text: msg.text }, key), ctx);
  return { status: res.status, body: (await res.json()) as { id: string; checkId: string | null; status: string; duplicate: boolean; settings: unknown } };
};
const rowsOf = (userId: string) => db.query.simMessages.findMany({ where: eq(schema.simMessages.userId, userId) });
const rowById = async (id: string) => (await db.query.simMessages.findFirst({ where: eq(schema.simMessages.id, id) }))!;
const checksOf = (userId: string) => db.query.checks.findMany({ where: eq(schema.checks.userId, userId) });
const alertsOn = (checkIds: string[]) => (checkIds.length ? db.query.alerts.findMany({ where: inArray(schema.alerts.checkId, checkIds) }) : Promise.resolve([]));
const pushedTo = (userId: string) => sendNotification.mock.calls.filter((c) => c[0].endpoint.endsWith(userId));
const payloads = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1]) as { tag: string; kind: string; alertId?: string });

describe("a watcher message is checked exactly once", () => {
  it("the same message posted three times: one row, one check, one alert and one push per family member", async () => {
    const { papa, son, daughter, token } = await household();
    const key = crypto.randomUUID();
    const first = await watcherPost(token, { text: text("cbi") }, key);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "checked", duplicate: false, settings: { watchSms: true, watchWhatsapp: true, unknownOnly: true } });
    expect(first.body.checkId).toBeTruthy();
    for (let i = 0; i < 2; i++) {
      const again = await watcherPost(token, { text: text("cbi") }, key);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: first.body.id, checkId: first.body.checkId, status: "checked", duplicate: true });
    }

    expect(await rowsOf(papa.id)).toHaveLength(1);
    expect(await checksOf(papa.id)).toHaveLength(1);
    const alerts = await alertsOn([first.body.checkId!]);
    expect(alerts.map((a) => [a.recipientId, a.kind]).sort()).toEqual([[son.id, "headsup"], [daughter.id, "headsup"]].sort());
    expect(pushedTo(son.id)).toHaveLength(1);
    expect(pushedTo(daughter.id)).toHaveLength(1);
    // The row is checked and keeps no text; the phone is counted once.
    expect(await rowById(first.body.id)).toMatchObject({ status: "checked", text: null, attempts: 1, deviceMessageId: key });
    expect((await listDevices(db, papa))[0].messagesSeen).toBe(1);
  });

  it("the same message posted three times at once: still one row and one check", async () => {
    const { papa, token } = await household();
    const key = crypto.randomUUID();
    const answers = await Promise.all([1, 2, 3].map(() => watcherPost(token, { text: text("kyc") }, key)));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(answers.filter((a) => !a.body.duplicate)).toHaveLength(1);
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect(await rowsOf(papa.id)).toHaveLength(1);
    expect(await checksOf(papa.id)).toHaveLength(1);
  });

  it("the key may come in the body, and a phone without one (an older app) is not deduplicated", async () => {
    const { papa, token } = await household();
    const key = crypto.randomUUID();
    await watcherPost(token, { text: text("cbi") });
    await watcherPost(token, { text: text("cbi") });
    expect(await rowsOf(papa.id)).toHaveLength(2);

    const body = { channel: "sms", sender: SENDER, fromContact: false, text: text("bank"), messageId: key };
    const one = await (await inboxPost(inboxRequest(token, body), ctx)).json();
    const two = await (await inboxPost(inboxRequest(token, body), ctx)).json();
    expect(two).toMatchObject({ id: one.id, duplicate: true });
    expect(await rowsOf(papa.id)).toHaveLength(3);

    const bad = await inboxPost(inboxRequest(token, { channel: "sms", sender: SENDER, fromContact: false, text: "hello" }, "not a key!"), ctx);
    expect(bad.status).toBe(400);
  });

  it("once the check is stored, a failure after it (a notification) is logged and does not fail the phone's post", async () => {
    const { papa, son, token } = await household();
    followUp.fail = true;
    const key = crypto.randomUUID();
    const res = await watcherPost(token, { text: text("cbi") }, key);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "checked", duplicate: false });
    expect(await rowById(res.body.id)).toMatchObject({ status: "checked", checkId: res.body.checkId, text: null });
    expect((await alertsOn([res.body.checkId!])).map((a) => a.recipientId)).toContain(son.id);
    expect(logged.some((l) => l.includes('"event":"check_followup_failed"') && l.includes('"step":"notify_owner"') && l.includes(res.body.checkId!))).toBe(true);
    // The phone posting it again changes nothing.
    expect((await watcherPost(token, { text: text("cbi") }, key)).body).toMatchObject({ checkId: res.body.checkId, duplicate: true });
    expect(await checksOf(papa.id)).toHaveLength(1);
  });

  it("a message that is not watched is skipped every time, and nothing about it is stored", async () => {
    const { papa, token } = await household();
    const key = crypto.randomUUID();
    const body = { channel: "sms", sender: "Meera (saved)", fromContact: true, text: "Papa, dinner at 8?" };
    for (let i = 0; i < 2; i++) {
      const res = await inboxPost(inboxRequest(token, body, key), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: null, checkId: null, status: "skipped", duplicate: false });
    }
    expect(await rowsOf(papa.id)).toEqual([]);
  });
});

describe("when the check fails", () => {
  it("the row says so and keeps the text, the phone gets a 202, and nobody is alerted", async () => {
    const { papa, token } = await household();
    checker.failures = 1;
    const res = await watcherPost(token, { text: text("cbi") }, crypto.randomUUID());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ checkId: null, status: "failed", settings: expect.any(Object) });
    expect(await rowById(res.body.id)).toMatchObject({ status: "failed", error: "ModelDown", attempts: 1, text: text("cbi"), checkId: null });
    expect(await checksOf(papa.id)).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();

    // Mr Rao's inbox: "We could not check this message", never "Not watched", and no banner.
    const [view] = await listInbox(db, papa.id);
    expect(view).toMatchObject({ status: "failed", verdict: null, text: null, canRetry: true });
    expect(await latestBanner(db, papa.id)).toBeNull();
  });

  it("Mr Rao's tap checks it again, and only he can", async () => {
    const { papa, son, token } = await household();
    checker.failures = 1;
    const { body } = await watcherPost(token, { text: text("cbi") }, crypto.randomUUID());
    const retry = (userId: string) => {
      scope.cookies.set("pb_rao", sessionToken(userId));
      return retryPost(new Request(`http://localhost/api/me/inbox/${body.id}/retry`, { method: "POST" }), { params: Promise.resolve({ id: body.id }) });
    };
    const [stranger] = await db.insert(schema.users).values({ name: "Someone", phone: "+91 98200 99991", role: "protected" }).returning();
    expect((await retry(stranger.id)).status).toBe(404);

    checker.failures = 1; // fails again: still "could not check"
    expect(await (await retry(papa.id)).json()).toMatchObject({ id: body.id, checkId: null, status: "failed" });
    expect((await rowById(body.id)).attempts).toBe(2);

    const ok = await (await retry(papa.id)).json();
    expect(ok).toMatchObject({ id: body.id, status: "checked" });
    expect(ok.checkId).toBeTruthy();
    expect(await rowById(body.id)).toMatchObject({ status: "checked", checkId: ok.checkId, text: null, error: null, attempts: 3 });
    expect((await alertsOn([ok.checkId])).map((a) => a.recipientId)).toContain(son.id);
    // A tap on a message that is checked by now changes nothing.
    expect(await (await retry(papa.id)).json()).toMatchObject({ checkId: ok.checkId, status: "checked" });
    expect(await checksOf(papa.id)).toHaveLength(1);
  });

  it("two tries checking it at the same moment (a double tap, or a tap and the sync job) still make one check", async () => {
    const { papa, son, token } = await household();
    checker.failures = 1;
    const { body } = await watcherPost(token, { text: text("cbi") }, crypto.randomUUID());
    checker.delayMs = 30; // both are classifying when the first one stores its check
    const tries = await Promise.all([retryMessage(db, papa, body.id), retryMessage(db, papa, body.id)]);
    expect(await checksOf(papa.id)).toHaveLength(1);
    const row = await rowById(body.id);
    expect(row).toMatchObject({ status: "checked", text: null });
    expect(tries.map((t) => t.checkId)).toEqual([row.checkId, row.checkId]);
    expect(tries.filter((t) => t.duplicate)).toHaveLength(1);
    expect((await alertsOn([row.checkId!])).filter((a) => a.recipientId === son.id)).toHaveLength(1);
  });
});

describe("the 30-minute sync job", () => {
  it("checks a failed message and one stuck half-way again; a scam then alerts the family", async () => {
    const { papa, son, daughter, token } = await household();
    checker.failures = 1;
    const failed = (await watcherPost(token, { text: text("cbi") }, crypto.randomUUID())).body;
    // The server stopped between storing a message and checking it.
    const [stuck] = await db
      .insert(schema.simMessages)
      .values({ userId: papa.id, channel: "sms", sender: SENDER, text: text("kyc"), status: "received", attempts: 1, lastTriedAt: new Date(Date.now() - 15 * MINUTE), createdAt: new Date(Date.now() - 15 * MINUTE) })
      .returning();
    // One being checked right now is left alone.
    const [busy] = await db.insert(schema.simMessages).values({ userId: papa.id, channel: "sms", sender: SENDER, text: text("lottery"), status: "received", attempts: 1, lastTriedAt: new Date() }).returning();

    const run = await runSync(db);
    expect(run).toMatchObject({ skipped: false, error: null });
    if (run.skipped) return;
    expect(run.rechecked).toBeGreaterThanOrEqual(2);
    expect(run.finishedAt).toBeTruthy();

    for (const id of [failed.id, stuck.id]) {
      const row = await rowById(id);
      expect(row).toMatchObject({ status: "checked", text: null, error: null });
      const alerts = await alertsOn([row.checkId!]);
      expect(alerts.map((a) => a.recipientId).sort()).toEqual([son.id, daughter.id].sort());
      expect(alerts.every((a) => a.kind === "headsup")).toBe(true);
    }
    expect(await rowById(busy.id)).toMatchObject({ status: "received", checkId: null });
    expect(pushedTo(son.id)).toHaveLength(2);

    // Nothing left to do for these: the next run checks nothing twice.
    await runSync(db);
    expect(await checksOf(papa.id)).toHaveLength(2);
  });

  it(`stops after ${MAX_ATTEMPTS} tries, and the text goes after 24 hours`, async () => {
    const { token } = await household();
    checker.failures = 100;
    const { id } = (await watcherPost(token, { text: text("cbi") }, crypto.randomUUID())).body;
    await runSync(db);
    await runSync(db);
    expect(await rowById(id)).toMatchObject({ status: "failed", attempts: 3 });
    await runSync(db);
    expect(await rowById(id)).toMatchObject({ status: "failed", attempts: 3, text: text("cbi") });

    // A fresh failure older than a day is not tried either: its text is gone with the purge.
    checker.failures = 1;
    const old = (await watcherPost(token, { text: text("kyc") }, crypto.randomUUID())).body;
    await db.update(schema.simMessages).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.simMessages.id, old.id));
    checker.failures = 0;
    await runSync(db);
    expect(await rowById(old.id)).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("a last try cut off half-way is not tried again, but reads \"could not check\" so Mr Rao can tap it", async () => {
    const { papa } = await household();
    const cutOff = { userId: papa.id, channel: "sms" as const, sender: SENDER, text: text("lottery"), status: "received" as const, attempts: MAX_ATTEMPTS };
    const [stuck] = await db.insert(schema.simMessages).values({ ...cutOff, lastTriedAt: new Date(Date.now() - 15 * MINUTE) }).returning();
    const [busy] = await db.insert(schema.simMessages).values({ ...cutOff, lastTriedAt: new Date() }).returning();
    await runSync(db);
    expect(await rowById(stuck.id)).toMatchObject({ status: "failed", error: "interrupted", attempts: MAX_ATTEMPTS, checkId: null, text: text("lottery") });
    expect(await rowById(busy.id)).toMatchObject({ status: "received", attempts: MAX_ATTEMPTS });
    expect(await checksOf(papa.id)).toEqual([]);
    expect((await listInbox(db, papa.id)).find((m) => m.id === stuck.id)).toMatchObject({ status: "failed", canRetry: true });

    const tapped = await retryMessage(db, papa, stuck.id);
    expect(tapped).toMatchObject({ status: "checked", duplicate: false });
    expect(await rowById(stuck.id)).toMatchObject({ status: "checked", checkId: tapped.checkId, error: null, text: null });
  });

  it("two runs at once: one works, the other stops; a run that crashed is taken over", async () => {
    checker.delayMs = 50; // give the first run something to do while the second asks
    const { token } = await household();
    checker.failures = 1;
    await watcherPost(token, { text: text("cbi") }, crypto.randomUUID());
    const runs = await Promise.all([runSync(db), runSync(db)]);
    expect(runs.filter((r) => r.skipped)).toHaveLength(1);
    expect(await db.query.syncRuns.findMany({ where: (r, { isNull }) => isNull(r.finishedAt) })).toEqual([]);

    const [crashed] = await db.insert(schema.syncRuns).values({ startedAt: new Date(Date.now() - 20 * MINUTE) }).returning();
    expect((await runSync(db)).skipped).toBe(false);
    expect(await db.query.syncRuns.findFirst({ where: eq(schema.syncRuns.id, crashed.id) })).toMatchObject({ error: "abandoned" });
    // A run in progress (not stale) is respected.
    const [running] = await db.insert(schema.syncRuns).values({ startedAt: new Date() }).returning();
    expect(await runSync(db)).toEqual({ skipped: true });
    await db.update(schema.syncRuns).set({ finishedAt: new Date() }).where(eq(schema.syncRuns.id, running.id));
  });

  it("pushes a scam alert once more when no phone confirmed it, and never one that was confirmed or opened", async () => {
    const { son, daughter, token } = await household();
    const first = (await watcherPost(token, { text: text("cbi") }, crypto.randomUUID())).body;
    const second = (await watcherPost(token, { text: text("kyc") }, crypto.randomUUID())).body;
    const alerts = await alertsOn([first.checkId!, second.checkId!]);
    await db.update(schema.alerts).set({ createdAt: new Date(Date.now() - 5 * MINUTE) }).where(inArray(schema.alerts.id, alerts.map((a) => a.id)));
    const alertOf = (checkId: string | null, userId: string) => alerts.find((a) => a.checkId === checkId && a.recipientId === userId)!;
    // The daughter's phone confirmed the first alert; the son opened the second one.
    const shown = await db.query.pushDeliveries.findFirst({ where: and(eq(schema.pushDeliveries.key, `alert:${alertOf(first.checkId, daughter.id).id}`)) });
    await recordReceipt(db, shown!.id, true);
    await db.update(schema.alerts).set({ openedAt: new Date() }).where(eq(schema.alerts.id, alertOf(second.checkId, son.id).id));

    sendNotification.mockClear();
    const run = await runSync(db);
    expect(run).toMatchObject({ skipped: false, repushed: 2 });
    const again = payloads();
    expect(again.map((p) => p.alertId).sort()).toEqual([alertOf(first.checkId, son.id).id, alertOf(second.checkId, daughter.id).id].sort());
    expect(again.every((p) => p.kind === "headsup" && p.tag === `alert-${p.alertId}`)).toBe(true);
    const repushed = await db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, `alert:${alertOf(first.checkId, son.id).id}:repush`) });
    expect(repushed).toHaveLength(1);
    expect((await db.query.alerts.findFirst({ where: eq(schema.alerts.id, alertOf(first.checkId, son.id).id) }))!.repushedAt).toBeTruthy();

    // Once only.
    sendNotification.mockClear();
    expect(await runSync(db)).toMatchObject({ repushed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("flags a phone silent for over an hour, once, and clears it when the phone is heard from", async () => {
    const { papa, son, token } = await household();
    const hourAgo = new Date(Date.now() - 61 * MINUTE);
    await db.update(schema.devices).set({ lastSeenAt: hourAgo }).where(eq(schema.devices.userId, papa.id));
    expect((await familyState(db, son)).people.find((p) => p.id === papa.id)?.watcher).toBe("ok");

    const run = await runSync(db);
    expect(run).toMatchObject({ skipped: false });
    if (!run.skipped) expect(run.quietDevices).toBeGreaterThanOrEqual(1);
    expect((await listDevices(db, papa))[0].notSyncing).toBe(true);
    expect((await familyState(db, son)).people.find((p) => p.id === papa.id)?.watcher).toBe("quiet");
    await runSync(db);
    const lines = (await db.query.events.findMany({ where: eq(schema.events.householdId, papa.id) })).filter((e) => e.type === "device_quiet");
    expect(lines.map((e) => e.message)).toEqual([`${papa.name}'s Android phone stopped syncing`]);

    // The phone's own 30-minute sync reports in.
    const res = await statusPost(
      new Request("http://localhost/api/device/status", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ listenerOn: true, waiting: 2, sync: true }),
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).device).toMatchObject({ notSyncing: false, waiting: 2, listenerOn: true, lastSyncAt: expect.any(String) });
    expect((await familyState(db, son)).people.find((p) => p.id === papa.id)?.watcher).toBe("ok");
    expect((await deviceByToken(db, `Bearer ${token}`)).device.notSyncingSince).toBeNull();
  });

  it("runs from the cron endpoint with CRON_SECRET only, and reports its health", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "a-long-random-cron-key";
    const call = (auth?: string) => cronSync(new Request("http://localhost/api/cron/sync", { method: "POST", headers: auth ? { authorization: auth } : {} }), ctx);
    expect((await call()).status).toBe(401);
    const ok = await call("Bearer a-long-random-cron-key");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ skipped: false, rechecked: expect.any(Number), repushed: expect.any(Number), quietDevices: expect.any(Number) });
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;

    const health = await (await syncHealthGet(new Request("http://localhost/api/ops/sync-health"), ctx)).json();
    expect(health).toMatchObject({ overdue: false, intervalMinutes: 30, lastRun: { finishedAt: expect.any(String) } });
    expect(health.runs.length).toBeGreaterThan(1);
    expect(health.runs.length).toBeLessThanOrEqual(20);
  });
});

describe("family hears automatically about a scam only", () => {
  it("a safe or suspicious watcher message alerts nobody and pushes nothing; Ask still reaches them", async () => {
    const { papa, son, daughter, token } = await household();
    const safe = (await watcherPost(token, { text: text("bank"), channel: "sms" }, crypto.randomUUID())).body;
    const suspicious = (await watcherPost(token, { text: text("courier"), channel: "sms" }, crypto.randomUUID())).body;
    const verdicts = (await checksOf(papa.id)).map((c) => [c.id, c.verdict]);
    expect(verdicts).toEqual(expect.arrayContaining([[safe.checkId, "SAFE"], [suspicious.checkId, "SUSPICIOUS"]]));
    expect(await alertsOn([safe.checkId!, suspicious.checkId!])).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();

    // Even a safe message: "Ask anyway" sends an ask to everyone.
    await askFamily(db, papa, safe.checkId!);
    const asks = await alertsOn([safe.checkId!]);
    expect(asks.map((a) => [a.recipientId, a.kind]).sort()).toEqual([[son.id, "ask"], [daughter.id, "ask"]].sort());
    expect(pushedTo(son.id)).toHaveLength(1);
    expect(pushedTo(daughter.id)).toHaveLength(1);
  });
});

describe("logs", () => {
  it("never carry a message or its sender", () => {
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.some((l) => l.includes('"event":"inbox_failed"'))).toBe(true);
    expect(logged.some((l) => l.includes('"event":"sync_run"'))).toBe(true);
    const all = logged.join("\n");
    for (const id of ["cbi", "kyc", "bank", "courier", "lottery"]) expect(all).not.toContain(text(id).slice(0, 40));
    expect(all).not.toContain(SENDER);
    expect(all).not.toContain("Meera (saved)");
    expect(all).not.toContain("dinner at 8");
  });
});
