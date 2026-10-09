import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Web Push against an in-memory database, with the push service mocked:
// who is sent what, retries, the delivery log, idempotency, sign-out, and
// where a tap on the notification lands.
process.env.PGLITE_DIR = "memory";
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

type Send = (subscription: unknown, payload: string, options?: unknown) => Promise<unknown>;
const sendNotification = vi.hoisted(() => vi.fn<Send>(async () => ({ statusCode: 201 })));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public headers: Record<string, string> = {},
      public body = "",
      public endpoint = "",
    ) {
      super(message);
    }
  }
  return { default: { setVapidDetails: vi.fn(), sendNotification }, WebPushError };
});

import { and, eq, inArray } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import examples from "@/data/examples.json";
import { markAlertOpened, openAlertFromNotification } from "./alerts";
import { createCheck, getCheckView, openPayment } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { decideHold } from "./holds";
import { pushEnabled, pushToUsers, removeSubscription, saveSubscription, type PushPayload } from "./push";
import { HttpError } from "./session";
import { deliverMessage } from "./sim";

const sub = (n: number) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });
const note = (tag = "t"): PushPayload => ({ title: "x", body: "y", url: "/family", tag, urgent: true });
const payloadsSent = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string) as PushPayload);
const text = (id: string) => examples.find((e) => e.id === id)!.text;
let db: Db;

const subsOf = (userId: string) => db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, userId) });
const deliveriesWith = (key: string) => db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, key) });
const users = async () => ({
  rao: (await personaUser(db, "rao"))!,
  arjun: (await personaUser(db, "arjun"))!,
  meera: (await personaUser(db, "meera"))!,
});

beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
});
beforeEach(() => sendNotification.mockClear());

describe("web push", () => {
  it("does nothing without VAPID keys", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, sub(1), "test");
    expect(pushEnabled()).toBe(false);
    expect(await pushToUsers(db, [arjun.id], note())).toEqual({ sent: 0, failed: 0, gone: 0, skipped: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    process.env.VAPID_PUBLIC_KEY = "public-test-key";
    process.env.VAPID_PRIVATE_KEY = "private-test-key";
  });

  it("keeps one row per phone, sends to every phone of a person, and logs each delivery", async () => {
    const { arjun } = await users();
    await saveSubscription(db, arjun.id, { ...sub(1), keys: { p256dh: "new", auth: "keys" } }, "test");
    await saveSubscription(db, arjun.id, sub(2), "test");
    expect((await subsOf(arjun.id)).map((r) => [r.endpoint, r.p256dh])).toEqual([
      ["https://push.example.test/1", "new"],
      ["https://push.example.test/2", "p2"],
    ]);

    const payload: PushPayload = { title: "Papa needs you now", body: "…", url: "/open/1", tag: "alert-1", urgent: true };
    expect(await pushToUsers(db, [arjun.id], payload, { key: "demo:one" })).toEqual({ sent: 2, failed: 0, gone: 0, skipped: 0 });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/), "public-test-key", "private-test-key");
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example.test/2", keys: { p256dh: "p2", auth: "a2" } },
      JSON.stringify(payload),
      { TTL: 300, urgency: "high" },
    );
    const log = await deliveriesWith("demo:one");
    expect(log.map((d) => [d.endpoint, d.status, d.statusCode, d.attempts, d.tag]).sort()).toEqual([
      ["https://push.example.test/1", "sent", 201, 1, "alert-1"],
      ["https://push.example.test/2", "sent", 201, 1, "alert-1"],
    ]);
  });

  it("never sends the same alert twice to one phone", async () => {
    const { arjun } = await users();
    expect(await pushToUsers(db, [arjun.id], note("alert-1"), { key: "demo:one" })).toEqual({ sent: 0, failed: 0, gone: 0, skipped: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
    // A different alert (key) goes out as usual; a test alert has no key and always goes out.
    expect(await pushToUsers(db, [arjun.id], note("alert-2"), { key: "demo:two" })).toMatchObject({ sent: 2, skipped: 0 });
    expect(await pushToUsers(db, [arjun.id], note("test-alert"))).toMatchObject({ sent: 2 });
  });

  it("forgets a phone the push service says is gone, and never throws", async () => {
    const { arjun } = await users();
    sendNotification.mockImplementationOnce(async () => {
      throw new WebPushError("gone", 410, {}, "", "https://push.example.test/1");
    });
    expect(await pushToUsers(db, [arjun.id], { ...note("t"), urgent: false }, { key: "demo:gone" })).toEqual({ sent: 1, failed: 0, gone: 1, skipped: 0 });
    expect((await subsOf(arjun.id)).map((r) => r.endpoint)).toEqual(["https://push.example.test/2"]);
    expect(sendNotification).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { TTL: 3600, urgency: "normal" });
    const gone = (await deliveriesWith("demo:gone")).find((d) => d.endpoint === "https://push.example.test/1");
    expect(gone).toMatchObject({ status: "gone", statusCode: 410, error: "gone" });
  });

  it("retries once when the push service is busy, and records the error when it keeps failing", async () => {
    const { arjun } = await users();
    // Busy once, then fine: delivered on the second attempt.
    sendNotification.mockImplementationOnce(async () => {
      throw new WebPushError("busy", 503, { "retry-after": "0" }, "", "");
    });
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:retry", retryDelayMs: 1 })).toMatchObject({ sent: 1, failed: 0 });
    expect((await deliveriesWith("demo:retry"))[0]).toMatchObject({ status: "sent", attempts: 2 });

    // Busy twice: given up, with the error kept for debugging.
    sendNotification.mockImplementation(async () => {
      throw new WebPushError("still busy", 503, {}, "", "");
    });
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:fail", retryDelayMs: 1 })).toMatchObject({ sent: 0, failed: 1 });
    expect((await deliveriesWith("demo:fail"))[0]).toMatchObject({ status: "failed", statusCode: 503, error: "still busy", attempts: 2 });
    expect(sendNotification).toHaveBeenCalledTimes(4);

    // A network error is temporary too; a 400 is not worth a second try.
    sendNotification.mockClear();
    sendNotification.mockImplementation(async () => {
      throw new Error("fetch failed");
    });
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:net", retryDelayMs: 1 })).toMatchObject({ failed: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    sendNotification.mockClear();
    sendNotification.mockImplementation(async () => {
      throw new WebPushError("bad request", 400, {}, "", "");
    });
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:bad", retryDelayMs: 1 })).toMatchObject({ failed: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect((await deliveriesWith("demo:bad"))[0]).toMatchObject({ status: "failed", statusCode: 400, attempts: 1 });
    // The phone is kept: only 404/410 mean it is gone.
    expect(await subsOf(arjun.id)).toHaveLength(1);
    sendNotification.mockImplementation(async () => ({ statusCode: 201 }));
  });

  it("skips a person who turned Notifications off, unless they asked for a test alert themselves", async () => {
    const { arjun } = await users();
    await db.update(schema.users).set({ alertNotify: false }).where(eq(schema.users.id, arjun.id));
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:off" })).toEqual({ sent: 0, failed: 0, gone: 0, skipped: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await pushToUsers(db, [arjun.id], note("test-alert"), { force: true })).toMatchObject({ sent: 1 });
    await db.update(schema.users).set({ alertNotify: true }).where(eq(schema.users.id, arjun.id));
  });

  it("a phone another person signs in on moves to them; sign-out forgets it; a replaced endpoint is forgotten", async () => {
    const { arjun, meera } = await users();
    // Meera signs in on the phone that was Arjun's (same endpoint): it is hers now.
    await saveSubscription(db, meera.id, sub(2), "test");
    expect(await subsOf(arjun.id)).toHaveLength(0);
    expect((await subsOf(meera.id)).map((r) => r.endpoint)).toEqual(["https://push.example.test/2"]);
    expect(await pushToUsers(db, [arjun.id], note(), { key: "demo:moved" })).toMatchObject({ sent: 0 });
    expect(await pushToUsers(db, [meera.id], note(), { key: "demo:moved" })).toMatchObject({ sent: 1 });

    // Meera signs out: the phone gets nothing until someone signs in again.
    await removeSubscription(db, meera.id, sub(2).endpoint);
    expect(await subsOf(meera.id)).toHaveLength(0);

    // The push service replaced Arjun's endpoint: the new one is kept, the old one dropped.
    await saveSubscription(db, arjun.id, sub(3), "test");
    await saveSubscription(db, arjun.id, sub(4), "test", sub(3).endpoint);
    expect((await subsOf(arjun.id)).map((r) => r.endpoint)).toEqual(["https://push.example.test/4"]);
  });

  it("a scam Papa pastes pushes to Arjun's phone; the tap opens the paused payment, even once it is handled", async () => {
    const { rao, arjun, meera } = await users();
    await saveSubscription(db, meera.id, sub(5), "test");
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    const alerts = await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) });
    const mine = alerts.find((a) => a.recipientId === arjun.id)!;
    const hers = alerts.find((a) => a.recipientId === meera.id)!;
    const payloads = payloadsSent();
    expect(payloads).toContainEqual(
      expect.objectContaining({
        title: "Papa needs you now",
        body: "Papa got a scam message asking for Rs 80,000. Nothing is paid. Tell Papa what to do.",
        urgent: true,
        kind: "urgent",
        url: `/open/${mine.id}`,
        tag: `alert-${mine.id}`,
        alertId: mine.id,
        checkId,
        at: mine.createdAt.toISOString(),
        // F2: the paused payment can be blocked from the notification itself.
        holdId,
        actions: [
          { action: "block", title: "Block payment" },
          { action: "fine", title: "It's fine" },
        ],
      }),
    );
    expect(payloads.map((p) => p.url).sort()).toEqual([`/open/${hers.id}`, `/open/${mine.id}`].sort());
    expect((await deliveriesWith(`alert:${mine.id}`))[0]).toMatchObject({ alertId: mine.id, checkId, status: "sent" });

    // The tap: Arjun's phone is sent to the payment, and the alert counts as opened (once).
    expect(await openAlertFromNotification(db, arjun, mine.id)).toEqual({ id: mine.id, kind: "urgent", checkId, holdId, handled: false, url: `/family/hold/${holdId}` });
    const opened = (await db.query.alerts.findFirst({ where: eq(schema.alerts.id, mine.id) }))!;
    expect(opened.openedAt).toBeTruthy();
    expect((await markAlertOpened(db, arjun, mine.id)).openedAt).toEqual(opened.openedAt);
    // Meera's alert is not his to open.
    await expect(openAlertFromNotification(db, arjun, hers.id)).rejects.toThrow(HttpError);

    // Arjun blocks it; the alert is handled, and a late tap still shows the payment, not the home screen.
    await decideHold(db, arjun, holdId!, "block", false);
    expect(await openAlertFromNotification(db, meera, hers.id)).toMatchObject({ handled: true, url: `/family/hold/${holdId}` });
    // The ask kind opens the message with the alert in hand.
    const { checkId: asked } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    expect(await openAlertFromNotification(db, arjun, (await db.query.alerts.findFirst({ where: and(eq(schema.alerts.checkId, asked), eq(schema.alerts.recipientId, arjun.id)) }))?.id ?? "none").catch((e) => e)).toBeInstanceOf(HttpError);
  });

  it("Papa's own phone hears about a message the watcher caught, and about the family's decision, in his language", async () => {
    const { rao, arjun } = await users();
    await db.update(schema.users).set({ language: "hi" }).where(eq(schema.users.id, rao.id));
    const papa = { ...rao, language: "hi" };
    await saveSubscription(db, rao.id, sub(9), "test");

    // A WhatsApp message arrives on his phone while the app is closed: "Possible scam from …", in Hindi.
    const row = await deliverMessage(db, papa, { channel: "whatsapp", sender: "+91 9XXXX XXXXX", fromContact: false, text: text("cbi") });
    const caught = payloadsSent().find((p) => p.kind === "message")!;
    expect(caught).toMatchObject({
      title: "+91 9XXXX XXXXX से शायद धोखा",
      url: `/check/${row.checkId}`,
      tag: `check-${row.checkId}`,
      urgent: true,
      checkId: row.checkId,
    });
    expect(caught.body).toMatch(/^“.+”.* जवाब मत दीजिए/);
    expect((await deliveriesWith(`check:${row.checkId}`))[0]).toMatchObject({ checkId: row.checkId, status: "sent", endpoint: sub(9).endpoint });
    // The family's quiet heads-up went out too; nothing to his phone twice.
    expect(payloadsSent().filter((p) => p.kind === "headsup")).toHaveLength(2);
    expect(payloadsSent().filter((p) => p.kind === "message")).toHaveLength(1);

    // He taps "Pay anyway": the hold alerts the family; Arjun blocks it; Papa's phone says "Payment cancelled".
    sendNotification.mockClear();
    const { holdId } = await openPayment(db, papa, row.checkId!);
    await decideHold(db, arjun, holdId, "block", false);
    const outcome = payloadsSent().find((p) => p.kind === "outcome")!;
    expect(outcome).toMatchObject({ title: "भुगतान रद्द", url: `/hold/${holdId}`, tag: `hold-${holdId}`, urgent: true, holdId, checkId: row.checkId });
    expect(outcome.body).toContain("Arjun");
    expect(outcome.body).toContain("Rs 80,000");
    expect(payloadsSent().filter((p) => p.kind === "outcome")).toHaveLength(1);

    // A safe message, or one the family said is fine with no payment paused, says so quietly.
    sendNotification.mockClear();
    const safe = await deliverMessage(db, papa, { channel: "sms", sender: "HDFCBK", fromContact: false, text: text("bank") });
    expect(payloadsSent().filter((p) => p.kind === "message" && p.checkId === safe.checkId)).toHaveLength(0);
    await db.update(schema.users).set({ language: "en" }).where(eq(schema.users.id, rao.id));
  });

  it("Papa's screen names whoever the alert could not reach, until they open it", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    // Start clean: earlier tests moved phones between people and switched Notifications off.
    await db.delete(schema.pushSubscriptions);
    await db.update(schema.users).set({ alertNotify: true }).where(inArray(schema.users.id, [arjun.id, meera.id]));
    await saveSubscription(db, arjun.id, sub(21), "test");
    await saveSubscription(db, meera.id, sub(22), "test");
    // Arjun's phone takes the push; Meera's push service keeps refusing it.
    sendNotification.mockImplementation(async (s) => {
      if ((s as { endpoint: string }).endpoint.endsWith("/22")) throw new WebPushError("bad request", 400, {}, "", "");
      return { statusCode: 201 };
    });
    const { checkId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    sendNotification.mockImplementation(async () => ({ statusCode: 201 }));

    expect((await getCheckView(db, checkId, { ownerId: rao.id })).unreachableNames).toEqual(["Meera"]);
    // Family screens never carry it.
    expect((await getCheckView(db, checkId, { member: arjun })).unreachableNames).toEqual([]);
    // Once Meera opens the alert in the app, she is no longer unreachable.
    const alert = (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).find((a) => a.recipientId === meera.id)!;
    await db.update(schema.alerts).set({ openedAt: new Date() }).where(eq(schema.alerts.id, alert.id));
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).unreachableNames).toEqual([]);
    // Someone with no phone registered (no push attempted) is not flagged.
    const mom = (await personaUser(db, "mom"))!;
    await db.delete(schema.pushSubscriptions);
    const quiet = await createCheck(db, mom, { text: text("cbi"), source: "paste" });
    expect((await getCheckView(db, quiet.checkId, { ownerId: mom.id })).unreachableNames).toEqual([]);
  });
});
