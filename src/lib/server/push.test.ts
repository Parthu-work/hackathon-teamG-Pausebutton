import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Web Push against an in-memory database, with the push service mocked.
process.env.PGLITE_DIR = "memory";
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

type Send = (subscription: unknown, payload: string, options?: unknown) => Promise<unknown>;
const sendNotification = vi.hoisted(() => vi.fn<Send>(async () => ({ statusCode: 201 })));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number) {
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
import { createCheck } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { pushEnabled, pushToUsers, saveSubscription } from "./push";

const sub = (n: number) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });
let db: Db;

beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
});
beforeEach(() => sendNotification.mockClear());

describe("web push", () => {
  it("does nothing without VAPID keys", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    await saveSubscription(db, arjun.id, sub(1), "test");
    expect(pushEnabled()).toBe(false);
    expect(await pushToUsers(db, [arjun.id], { title: "x", body: "y", url: "/family", tag: "t", urgent: true })).toEqual({ sent: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    process.env.VAPID_PUBLIC_KEY = "public-test-key";
    process.env.VAPID_PRIVATE_KEY = "private-test-key";
  });

  it("keeps one row per phone and sends to every phone of a person", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    await saveSubscription(db, arjun.id, { ...sub(1), keys: { p256dh: "new", auth: "keys" } }, "test");
    await saveSubscription(db, arjun.id, sub(2), "test");
    const rows = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) });
    expect(rows.map((r) => [r.endpoint, r.p256dh])).toEqual([
      ["https://push.example.test/1", "new"],
      ["https://push.example.test/2", "p2"],
    ]);

    const payload = { title: "Papa needs you now", body: "…", url: "/family/alert/1", tag: "alert-1", urgent: true };
    expect(await pushToUsers(db, [arjun.id], payload)).toEqual({ sent: 2 });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/), "public-test-key", "private-test-key");
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example.test/2", keys: { p256dh: "p2", auth: "a2" } },
      JSON.stringify(payload),
      { TTL: 300, urgency: "high" },
    );
  });

  it("forgets a phone the push service says is gone, and never throws", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    sendNotification.mockImplementationOnce(async () => {
      throw new WebPushError("gone", 410, {}, "", "https://push.example.test/1");
    });
    const { sent } = await pushToUsers(db, [arjun.id], { title: "t", body: "b", url: "/family", tag: "t", urgent: false });
    expect(sent).toBe(1);
    const left = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) });
    expect(left).toHaveLength(1);
    expect(sendNotification).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { TTL: 3600, urgency: "normal" });
  });

  it("a scam Papa pastes pushes to Arjun's phone with his own alert link", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const arjun = (await personaUser(db, "arjun"))!;
    const { checkId } = await createCheck(db, rao, { text: examples.find((e) => e.id === "cbi")!.text, source: "paste" });
    const alert = (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).find((a) => a.recipientId === arjun.id)!;
    const payloads = sendNotification.mock.calls.map((c) => JSON.parse(c[1]));
    expect(payloads).toContainEqual(
      expect.objectContaining({
        title: "Papa needs you now",
        body: "Papa got a scam message asking for Rs 80,000. Nothing is paid. Tell Papa what to do.",
        urgent: true,
        url: `/family/alert/${alert.id}`,
        tag: `alert-${alert.id}`,
        // F2: the paused payment can be blocked from the notification itself.
        holdId: expect.any(String),
        actions: [
          { action: "block", title: "Block payment" },
          { action: "fine", title: "It's fine" },
        ],
      }),
    );
  });
});
