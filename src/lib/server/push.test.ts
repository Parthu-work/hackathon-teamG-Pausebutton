import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Web Push against an in-memory database, with the push service mocked.
process.env.PGLITE_DIR = "memory";
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

type Send = (subscription: { endpoint: string }, payload: string, options?: unknown) => Promise<unknown>;
const sendNotification = vi.hoisted(() => vi.fn<Send>(async () => ({ statusCode: 201 })));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number, public headers: Record<string, string> = {}, public body = "", public endpoint = "") {
      super(message);
    }
  }
  return { default: { setVapidDetails: vi.fn(), sendNotification }, WebPushError };
});

import { eq } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import examples from "@/data/examples.json";
import { askFamily, createCheck, getCheckView } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { addAdvice, decideHold } from "./holds";
import { familyAlertDestination, parseOpen } from "./open";
import {
  pushConfig,
  pushEnabled,
  pushToUsers,
  removeSubscription,
  replaceSubscription,
  retryDuePushes,
  saveSubscription,
  type PushPayload,
} from "./push";
import { familyState } from "./state";

const sub = (n: number) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });
const payload = (extra: Partial<PushPayload> = {}): PushPayload => ({ title: "t", body: "b", url: "/family", tag: "t", urgent: false, app: "family", ...extra });
const text = (id: string) => examples.find((e) => e.id === id)!.text;
const sentTo = () => sendNotification.mock.calls.map((c) => c[0].endpoint);
const payloads = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1]) as PushPayload & { id: string });
const fail = (status: number, headers: Record<string, string> = {}) => async () => {
  throw new WebPushError("push service said no", status, headers, "", "");
};
let db: Db;
const users = async () => ({
  rao: (await personaUser(db, "rao"))!,
  arjun: (await personaUser(db, "arjun"))!,
  meera: (await personaUser(db, "meera"))!,
});
const notifications = (userId: string) => db.query.pushNotifications.findMany({ where: eq(schema.pushNotifications.userId, userId) });

beforeAll(async () => {
  db = await getDb();
  pushConfig.retryDelaysMs = [0, 0];
});

beforeEach(async () => {
  sendNotification.mockReset();
  sendNotification.mockImplementation(async () => ({ statusCode: 201 }));
  await db.delete(schema.pushSubscriptions);
  await db.delete(schema.pushNotifications);
  await resetDemo(db);
  await db.update(schema.users).set({ alertNotify: true });
});

describe("web push: sending", () => {
  it("does nothing without VAPID keys", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    expect(pushEnabled()).toBe(false);
    expect(await pushToUsers(db, [arjun.id], payload())).toEqual({ sent: 0, results: [] });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await notifications(arjun.id)).toEqual([]);
    process.env.VAPID_PUBLIC_KEY = "public-test-key";
    process.env.VAPID_PRIVATE_KEY = "private-test-key";
  });

  it("keeps one row per phone and sends to every phone of a person", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await saveSubscription(db, arjun.id, { ...sub(1), keys: { p256dh: "new", auth: "keys" } }, "test");
    await saveSubscription(db, arjun.id, sub(2), "test");
    const rows = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) });
    expect(rows.map((r) => [r.endpoint, r.p256dh]).sort()).toEqual([
      ["https://push.example.test/1", "new"],
      ["https://push.example.test/2", "p2"],
    ]);

    const p = payload({ title: "Papa needs you now", url: "/open?alert=1", tag: "check-1", urgent: true });
    const r = await pushToUsers(db, [arjun.id], p);
    expect(r.sent).toBe(2);
    expect(r.results).toEqual([{ userId: arjun.id, status: "sent", delivered: 2 }]);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/), "public-test-key", "private-test-key");
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example.test/2", keys: { p256dh: "p2", auth: "a2" } },
      expect.any(String),
      { TTL: 300, urgency: "high", timeout: pushConfig.timeoutMs },
    );
    // The notification id travels with the payload, for debugging on the phone.
    const [row] = await notifications(arjun.id);
    expect(payloads()[0]).toEqual({ ...p, id: row.id });
    expect(row).toMatchObject({ status: "sent", devices: 2, delivered: 2, attempts: 1, lastError: null });
  });

  it("is idempotent: one dedupe key is sent once per person", async () => {
    const { arjun, meera } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await saveSubscription(db, meera.id, sub(2), "test");
    const first = await pushToUsers(db, [arjun.id, meera.id], payload(), { dedupeKey: "alert:x" });
    const again = await pushToUsers(db, [arjun.id, arjun.id], payload(), { dedupeKey: "alert:x" });
    expect(first.sent).toBe(2);
    expect(again).toEqual({ sent: 0, results: [{ userId: arjun.id, status: "duplicate", delivered: 0 }] });
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("respects the person's Notifications setting", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await db.update(schema.users).set({ alertNotify: false }).where(eq(schema.users.id, arjun.id));
    const r = await pushToUsers(db, [arjun.id], payload());
    expect(r.results[0].status).toBe("disabled");
    expect(sendNotification).not.toHaveBeenCalled();
    expect((await notifications(arjun.id))[0]).toMatchObject({ status: "disabled", lastError: "Notifications are turned off in settings" });
  });

  it("records a person with no registered phone", async () => {
    const { arjun } = await users();
    const r = await pushToUsers(db, [arjun.id], payload());
    expect(r.results[0].status).toBe("no_device");
  });
});

describe("web push: failures", () => {
  it("forgets a phone the push service says is gone, and never throws", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await saveSubscription(db, arjun.id, sub(2), "test");
    sendNotification.mockImplementation(async (s) => {
      if (s.endpoint.endsWith("/1")) throw new WebPushError("gone", 410, {}, "", s.endpoint);
      return { statusCode: 201 };
    });
    const { sent } = await pushToUsers(db, [arjun.id], payload());
    expect(sent).toBe(1);
    const left = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) });
    expect(left.map((s) => s.endpoint)).toEqual(["https://push.example.test/2"]);
    expect(sendNotification).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { TTL: 3600, urgency: "normal", timeout: pushConfig.timeoutMs });
  });

  it("retries a transient failure at once, then succeeds", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    sendNotification.mockImplementationOnce(fail(503)).mockImplementationOnce(async () => {
      throw new Error("socket hang up");
    });
    const r = await pushToUsers(db, [arjun.id], payload());
    expect(r.results[0]).toMatchObject({ status: "sent", delivered: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying a push service outage from the household's polling, once per claim", async () => {
    const { rao, arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    sendNotification.mockImplementation(fail(429, { "retry-after": "0" }));
    const r = await pushToUsers(db, [arjun.id], payload(), { dedupeKey: "alert:retry", householdId: rao.id });
    expect(r.results[0].status).toBe("retrying");
    expect(sendNotification).toHaveBeenCalledTimes(3); // first try + 2 quick retries
    let [row] = await notifications(arjun.id);
    expect(row).toMatchObject({ status: "retrying", attempts: 1 });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastError).toContain("429");

    // Not due yet: nothing happens.
    await retryDuePushes(db, rao.id);
    expect(sendNotification).toHaveBeenCalledTimes(3);

    // Due, and the service is back: two polls at once send it exactly once.
    sendNotification.mockReset();
    sendNotification.mockImplementation(async () => ({ statusCode: 201 }));
    await db.update(schema.pushNotifications).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.pushNotifications.id, row.id));
    await Promise.all([retryDuePushes(db, rao.id), retryDuePushes(db, rao.id)]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    [row] = await notifications(arjun.id);
    expect(row).toMatchObject({ status: "sent", attempts: 2, nextAttemptAt: null });
    const sub1 = await db.query.pushSubscriptions.findFirst({ where: eq(schema.pushSubscriptions.endpoint, sub(1).endpoint) });
    expect(sub1).toMatchObject({ failureCount: 0, lastError: null });
  });

  it("gives up on a stale alert instead of ringing late", async () => {
    const { rao, arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    sendNotification.mockImplementation(fail(500));
    await pushToUsers(db, [arjun.id], payload(), { householdId: rao.id });
    await db
      .update(schema.pushNotifications)
      .set({ createdAt: new Date(Date.now() - pushConfig.giveUpAfterMs - 1000), nextAttemptAt: new Date(0) })
      .where(eq(schema.pushNotifications.userId, arjun.id));
    sendNotification.mockClear();
    await retryDuePushes(db, rao.id);
    expect(sendNotification).not.toHaveBeenCalled();
    expect((await notifications(arjun.id))[0].status).toBe("failed");
  });

  it("forgets a phone after repeated permanent failures (e.g. keys no longer match)", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    sendNotification.mockImplementation(fail(403));
    for (let i = 1; i < pushConfig.forgetAfterFailures; i++) {
      expect((await pushToUsers(db, [arjun.id], payload())).results[0].status).toBe("failed");
      const s = await db.query.pushSubscriptions.findFirst({ where: eq(schema.pushSubscriptions.userId, arjun.id) });
      expect(s).toMatchObject({ failureCount: i, lastError: expect.stringContaining("403") });
    }
    await pushToUsers(db, [arjun.id], payload());
    expect(await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) })).toEqual([]);
    // A permanent error is not retried.
    expect(sendNotification).toHaveBeenCalledTimes(pushConfig.forgetAfterFailures);
  });
});

describe("web push: phones and people", () => {
  it("signing out stops this phone's alerts; the next person to sign in gets the phone", async () => {
    const { arjun, meera } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await removeSubscription(db, meera.id, sub(1).endpoint); // someone else cannot remove it
    expect((await pushToUsers(db, [arjun.id], payload())).sent).toBe(1);

    await removeSubscription(db, arjun.id, sub(1).endpoint); // Arjun signs out on this phone
    expect((await pushToUsers(db, [arjun.id], payload())).results[0].status).toBe("no_device");

    await saveSubscription(db, arjun.id, sub(1), "test"); // he signs in again …
    await saveSubscription(db, meera.id, sub(1), "test"); // … then Meera signs in on the same phone
    expect((await pushToUsers(db, [arjun.id], payload())).results[0].status).toBe("no_device");
    expect((await pushToUsers(db, [meera.id], payload())).sent).toBe(1);
  });

  it("follows the browser to a new endpoint, for the same person", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    expect(await replaceSubscription(db, sub(1).endpoint, sub(9), "test")).toBe(true);
    expect(await replaceSubscription(db, "https://push.example.test/unknown", sub(8), "test")).toBe(false);
    const rows = await db.query.pushSubscriptions.findMany();
    expect(rows.map((r) => [r.userId, r.endpoint])).toEqual([[arjun.id, sub(9).endpoint]]);
  });

  it("sender and recipients on different phones: each gets only their own", async () => {
    const { rao, arjun, meera } = await users();
    await saveSubscription(db, rao.id, sub(1), "rao's phone");
    await saveSubscription(db, arjun.id, sub(2), "arjun's phone");
    await saveSubscription(db, meera.id, sub(3), "meera's phone");
    await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect(sentTo().sort()).toEqual([sub(2).endpoint, sub(3).endpoint]);
  });
});

describe("web push: alerts and deep links", () => {
  it("a scam Papa pastes pushes to Arjun's phone with a link to his own alert", async () => {
    const { rao, arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const alert = (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).find((a) => a.recipientId === arjun.id)!;
    expect(payloads()).toEqual([
      expect.objectContaining({
        title: "Papa needs you now",
        body: "Papa got a scam message asking for Rs 80,000. Nothing is paid. Tell Papa what to do.",
        urgent: true,
        app: "family",
        url: `/open?alert=${alert.id}`,
        tag: `check-${checkId}`,
      }),
    ]);
    const row = (await notifications(arjun.id))[0];
    expect(row).toMatchObject({ dedupeKey: `alert:${alert.id}`, householdId: rao.id, status: "sent" });
    const log = await db.query.events.findMany({ where: eq(schema.events.householdId, rao.id) });
    expect(log.map((e) => e.message)).toContain("Push notification sent to 1 phone (Arjun)");
    expect(log.map((e) => e.message)).toContain("Push not delivered to Meera: no phone registered for notifications. They see it when they open the app.");
  });

  it("several alerts in a row each get their own notification and link", async () => {
    const { rao, arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    const a = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const b = await createCheck(db, rao, { text: text("kyc"), source: "paste" });
    const c = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    await askFamily(db, rao, c.checkId);
    const tags = payloads().map((p) => p.tag);
    expect(tags).toEqual([`check-${a.checkId}`, `check-${b.checkId}`, `check-${c.checkId}`]);
    expect(new Set(payloads().map((p) => p.url)).size).toBe(3);
  });

  it("tells Papa when his family cannot be reached, so he calls them", async () => {
    const { rao, arjun, meera } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    await db.update(schema.users).set({ alertNotify: false }).where(eq(schema.users.id, meera.id));
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).unreachableNames).toEqual(["Meera"]);
    // Family phones never see this list.
    expect((await getCheckView(db, checkId, { member: arjun })).unreachableNames).toEqual([]);
    // Once Meera opens the alert herself, she is reached.
    const alert = (await db.query.alerts.findMany({ where: eq(schema.alerts.recipientId, meera.id) }))[0];
    await familyAlertDestination(db, meera.id, alert.id);
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).unreachableNames).toEqual([]);
  });

  it("Papa's phone is told when Arjun blocks the payment or sends advice", async () => {
    const { rao, arjun } = await users();
    await saveSubscription(db, rao.id, sub(5), "rao's phone");
    const { holdId, checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await addAdvice(db, arjun, { holdId: holdId! }, "Hang up. Do not pay or click anything.");
    await decideHold(db, arjun, holdId!, "block", false);
    expect(payloads()).toEqual([
      expect.objectContaining({ title: "Arjun says:", body: "Hang up. Do not pay or click anything.", app: "rao", url: `/open?app=rao&to=%2Fhold%2F${holdId}`, tag: `rao-check-${checkId}` }),
      expect.objectContaining({ title: "Arjun blocked the payment", body: "Rs 80,000 was not paid. Do not pay or reply to that message.", app: "rao", url: `/open?app=rao&to=%2Fhold%2F${holdId}`, urgent: true }),
    ]);
    expect(parseOpen(new URL(`http://x${payloads()[1].url}`).searchParams)).toEqual({ app: "rao", to: `/hold/${holdId}` });
  });

  it("a tapped notification opens the payment or the message, and marks the alert seen", async () => {
    const { rao, arjun, meera } = await users();
    const scam = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const asked = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    await askFamily(db, rao, asked.checkId);
    const mine = await db.query.alerts.findMany({ where: eq(schema.alerts.recipientId, arjun.id) });
    const urgent = mine.find((a) => a.checkId === scam.checkId)!;
    const ask = mine.find((a) => a.checkId === asked.checkId)!;

    expect(await familyAlertDestination(db, arjun.id, urgent.id)).toBe(`/family/hold/${scam.holdId}?via=push`);
    expect(await familyAlertDestination(db, arjun.id, ask.id)).toBe(`/family/check/${asked.checkId}?alert=${ask.id}&via=push`);
    expect((await familyState(db, arjun)).alerts.every((a) => a.openedAt)).toBe(true);
    // Tapping twice is fine; only the first open is logged.
    await familyAlertDestination(db, arjun.id, urgent.id);
    const opened = (await db.query.events.findMany({ where: eq(schema.events.householdId, rao.id) })).filter((e) => e.type === "opened");
    expect(opened.map((e) => e.message)).toEqual(["Arjun opened it from the notification · status seen", "Arjun opened it from the notification · status seen"]);

    // Already decided by Meera: the link still opens that payment (it shows the outcome), not the home screen.
    await decideHold(db, meera, scam.holdId!, "block", false);
    expect(await familyAlertDestination(db, arjun.id, urgent.id)).toBe(`/family/hold/${scam.holdId}?via=push`);

    // Someone else's alert (another person signed in on this phone) never opens: their own home instead.
    expect(await familyAlertDestination(db, meera.id, urgent.id)).toBe("/family");
    expect(await familyAlertDestination(db, arjun.id, "no-such-alert")).toBe("/family");
  });

  it("only accepts well-formed deep links", () => {
    const p = (q: string) => parseOpen(new URLSearchParams(q));
    expect(p("alert=abc-123")).toEqual({ app: "family", alertId: "abc-123" });
    expect(p("app=rao&to=/check/abc")).toEqual({ app: "rao", to: "/check/abc" });
    expect(p("alert=../x")).toBeNull();
    expect(p("app=rao&to=//evil.example")).toBeNull();
    expect(p("app=rao&to=/settings")).toBeNull();
    expect(p("")).toBeNull();
  });
});
