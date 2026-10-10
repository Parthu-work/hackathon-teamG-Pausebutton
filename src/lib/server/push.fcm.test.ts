import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// FCM (the Android app) against an in-memory database, with Google's token
// endpoint and FCM's send endpoint standing in for `fetch`: the service
// account sign-in, the data-only message, the delivery log and receipts,
// forgetting a token FCM no longer knows, the one retry, idempotency, and a
// person with both a browser (Web Push, mocked) and the Android app.
process.env.PGLITE_DIR = "memory";
process.env.VAPID_PUBLIC_KEY = "public-test-key";
process.env.VAPID_PRIVATE_KEY = "private-test-key";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SERVICE_ACCOUNT = { type: "service_account", project_id: "pause-test", client_email: "push@pause-test.iam.gserviceaccount.com", private_key: privateKey };
// The base64 form, as a host's settings page would hold it.
process.env.FCM_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(SERVICE_ACCOUNT)).toString("base64");

type Send = (subscription: unknown, payload: string, options?: unknown) => Promise<unknown>;
const sendNotification = vi.hoisted(() => vi.fn<Send>(async () => ({ statusCode: 201 })));
vi.mock("web-push", () => {
  class WebPushError extends Error {}
  return { default: { setVapidDetails: vi.fn(), sendNotification }, WebPushError };
});

// Next's request scope, for the subscribe route.
const scope = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => scope.headers,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { DELETE as subscribeDelete, POST as subscribePost } from "@/app/api/push/subscribe/route";
import { personaUser, resetDemo } from "./demo";
import { fcmEnabled, fcmEndpoint, pushEnabled, pushPublicKey, pushToUsers, recordReceipt, saveFcmToken, saveSubscription, type PushPayload } from "./push";
import { sessionToken } from "./session";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://fcm.googleapis.com/v1/projects/pause-test/messages:send";

type Sent = { token: string; data: Record<string, string>; android: { priority: string; ttl: string }; [other: string]: unknown };
/** What FCM answers next (one per send, in order); 200 once they run out. */
let fcmAnswers: Response[] = [];
let fetchMock: MockInstance<typeof fetch>;
const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u) === url);
const sentMessages = () => calls(SEND_URL).map(([, init]) => (JSON.parse(String(init!.body)) as { message: Sent }).message);
const fcmError = (status: number, code: string, message: string, extra: object[] = []) =>
  Response.json(
    { error: { code: status, message, status: code === "UNREGISTERED" ? "NOT_FOUND" : code, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }, ...extra] } },
    { status },
  );

let db: Db;
const users = async () => ({ arjun: (await personaUser(db, "arjun"))!, meera: (await personaUser(db, "meera"))! });
const subsOf = (userId: string) => db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, userId) });
const deliveriesWith = (key: string) => db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, key) });
const TOKEN_A = "dTokenA:APA91b-android-phone-a";
const TOKEN_B = "dTokenB:APA91b-android-phone-b";

beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
  const realFetch = globalThis.fetch;
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === TOKEN_URL) return Response.json({ access_token: "ya29.test-access-token", expires_in: 3599, token_type: "Bearer" });
    if (url === SEND_URL) return fcmAnswers.shift() ?? Response.json({ name: "projects/pause-test/messages/1" });
    return realFetch(input, init);
  });
});
beforeEach(() => {
  fetchMock.mockClear();
  sendNotification.mockClear();
  fcmAnswers = [];
});
afterEach(() => {
  scope.headers = new Headers();
});

describe("FCM: the Android app", () => {
  it("counts as push being set up, without changing the browsers' VAPID key", () => {
    expect(fcmEnabled()).toBe(true);
    expect(pushEnabled()).toBe(true);
    expect(pushPublicKey()).toBe("public-test-key");
  });

  it("signs in with the service account once, and sends a data-only message the app shows itself", async () => {
    const { arjun } = await users();
    await saveFcmToken(db, arjun.id, TOKEN_A, "test");
    await saveFcmToken(db, arjun.id, TOKEN_B, "test");
    const payload: PushPayload = {
      title: "Papa needs you now",
      body: "Rs 80,000 to an unknown account",
      url: "/open/a1",
      tag: "alert-a1",
      urgent: true,
      kind: "urgent",
      alertId: "a1",
      checkId: "c1",
      holdId: "h1",
      who: "Papa",
      at: "2026-10-10T10:00:00.000Z",
      actions: [{ action: "block", title: "Block payment" }, { action: "fine", title: "It's fine" }],
    };
    expect(await pushToUsers(db, [arjun.id], payload, { key: "fcm:one" })).toEqual({ sent: 2, failed: 0, gone: 0, skipped: 0 });
    expect(sendNotification).not.toHaveBeenCalled();

    // One token exchange for both phones, with a JWT signed by the service account's key.
    expect(calls(TOKEN_URL)).toHaveLength(1);
    const form = new URLSearchParams(String(calls(TOKEN_URL)[0][1]!.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = form.get("assertion")!.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: SERVICE_ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: TOKEN_URL,
    });

    const sends = calls(SEND_URL);
    expect(sends).toHaveLength(2);
    for (const [, init] of sends) expect(new Headers(init!.headers).get("authorization")).toBe("Bearer ya29.test-access-token");

    const log = await deliveriesWith("fcm:one");
    expect(log.map((d) => [d.endpoint, d.status, d.statusCode, d.attempts]).sort()).toEqual([
      [fcmEndpoint(TOKEN_A), "sent", 200, 1],
      [fcmEndpoint(TOKEN_B), "sent", 200, 1],
    ]);
    for (const message of sentMessages()) {
      // Data only: no "notification" block, so the app always builds the notification (and posts the receipt).
      expect(Object.keys(message).sort()).toEqual(["android", "data", "token"]);
      expect(Object.values(message.data).every((v) => typeof v === "string")).toBe(true);
      const row = log.find((d) => d.endpoint === fcmEndpoint(message.token))!;
      expect(message.data).toEqual({
        title: "Papa needs you now",
        body: "Rs 80,000 to an unknown account",
        url: "/open/a1",
        tag: "alert-a1",
        urgent: "1",
        kind: "urgent",
        alertId: "a1",
        checkId: "c1",
        holdId: "h1",
        who: "Papa",
        at: "2026-10-10T10:00:00.000Z",
        actions: JSON.stringify(payload.actions),
        receipt: row.id,
      });
      expect(message.android).toEqual({ priority: "HIGH", ttl: "300s" });
    }

    // The app's receipt lands on the delivery row like the service worker's.
    await recordReceipt(db, log[0].id, true);
    expect((await deliveriesWith("fcm:one")).find((d) => d.id === log[0].id)).toMatchObject({ receivedAt: expect.any(Date), shownAt: expect.any(Date) });

    // The access token is kept for the next alert.
    fetchMock.mockClear();
    await pushToUsers(db, [arjun.id], { title: "Heads-up", body: "…", url: "/family", tag: "t", urgent: false });
    expect(calls(TOKEN_URL)).toHaveLength(0);
    expect(calls(SEND_URL)).toHaveLength(2);
    for (const message of sentMessages()) {
      expect(message.android).toEqual({ priority: "NORMAL", ttl: "3600s" });
      expect(message.data).toEqual({ title: "Heads-up", body: "…", url: "/family", tag: "t", urgent: "0", receipt: expect.any(String) });
    }
  });

  it("never sends the same alert twice to one phone", async () => {
    const { arjun } = await users();
    const note: PushPayload = { title: "x", body: "y", url: "/open/a1", tag: "alert-a1", urgent: true };
    expect(await pushToUsers(db, [arjun.id], note, { key: "fcm:one" })).toEqual({ sent: 0, failed: 0, gone: 0, skipped: 2 });
    expect(calls(SEND_URL)).toHaveLength(0);
  });

  it("forgets a phone FCM no longer knows (UNREGISTERED), and logs it as gone", async () => {
    const { arjun } = await users();
    fcmAnswers = [fcmError(404, "UNREGISTERED", "Requested entity was not found.")];
    expect(await pushToUsers(db, [arjun.id], { title: "x", body: "y", url: "/family", tag: "t", urgent: true }, { key: "fcm:gone" })).toEqual({
      sent: 1,
      failed: 0,
      gone: 1,
      skipped: 0,
    });
    const gone = (await deliveriesWith("fcm:gone")).find((d) => d.status === "gone")!;
    expect(gone).toMatchObject({ statusCode: 404, attempts: 1, error: "UNREGISTERED: Requested entity was not found." });
    expect((await subsOf(arjun.id)).map((r) => r.endpoint)).toEqual([fcmEndpoint(TOKEN_A), fcmEndpoint(TOKEN_B)].filter((e) => e !== gone.endpoint));
  });

  it("forgets a token FCM calls invalid, but not the phone when the message itself was refused", async () => {
    const { meera } = await users();
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, meera.id));
    await saveFcmToken(db, meera.id, "meera-token-0001", "test");
    const note: PushPayload = { title: "x", body: "y", url: "/family", tag: "t", urgent: true };

    fcmAnswers = [fcmError(400, "INVALID_ARGUMENT", "Invalid value at 'message.data[0].value' (TYPE_STRING)")];
    expect(await pushToUsers(db, [meera.id], note, { retryDelayMs: 0 })).toMatchObject({ sent: 0, failed: 1, gone: 0 });
    expect(calls(SEND_URL)).toHaveLength(1); // a refused message is not worth a retry
    expect(await subsOf(meera.id)).toHaveLength(1);

    fcmAnswers = [
      fcmError(400, "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", [
        { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token", description: "Invalid registration token" }] },
      ]),
    ];
    expect(await pushToUsers(db, [meera.id], note, { retryDelayMs: 0 })).toMatchObject({ sent: 0, failed: 0, gone: 1 });
    expect(await subsOf(meera.id)).toEqual([]);
  });

  it("retries once when FCM is busy (503 then 200), and gives up after the second failure", async () => {
    const { meera } = await users();
    await saveFcmToken(db, meera.id, "meera-token-0002", "test");
    const note: PushPayload = { title: "x", body: "y", url: "/family", tag: "t", urgent: true };

    fcmAnswers = [fcmError(503, "UNAVAILABLE", "The service is currently unavailable.")];
    expect(await pushToUsers(db, [meera.id], note, { key: "fcm:busy", retryDelayMs: 0 })).toEqual({ sent: 1, failed: 0, gone: 0, skipped: 0 });
    expect(calls(SEND_URL)).toHaveLength(2);
    expect(await deliveriesWith("fcm:busy")).toEqual([expect.objectContaining({ status: "sent", statusCode: 200, attempts: 2 })]);

    fetchMock.mockClear();
    fcmAnswers = [fcmError(503, "UNAVAILABLE", "Unavailable"), fcmError(500, "INTERNAL", "Internal error")];
    expect(await pushToUsers(db, [meera.id], note, { key: "fcm:down", retryDelayMs: 0 })).toEqual({ sent: 0, failed: 1, gone: 0, skipped: 0 });
    expect(calls(SEND_URL)).toHaveLength(2);
    expect(await deliveriesWith("fcm:down")).toEqual([expect.objectContaining({ status: "failed", statusCode: 500, attempts: 2, error: "INTERNAL: Internal error" })]);
    expect(await subsOf(meera.id)).toHaveLength(1); // a failure is not a goodbye
  });

  it("signs in afresh when FCM refuses the access token (401), then sends", async () => {
    const { meera } = await users();
    fcmAnswers = [fcmError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.")];
    expect(await pushToUsers(db, [meera.id], { title: "x", body: "y", url: "/family", tag: "t", urgent: true }, { key: "fcm:401", retryDelayMs: 0 })).toMatchObject({ sent: 1 });
    expect(calls(TOKEN_URL)).toHaveLength(1);
    expect(await deliveriesWith("fcm:401")).toEqual([expect.objectContaining({ status: "sent", attempts: 2 })]);
  });

  it("reaches a person on a browser and on the Android app with the same alert", async () => {
    const { arjun, meera } = await users();
    await saveSubscription(db, meera.id, { endpoint: "https://push.example.test/meera", keys: { p256dh: "p", auth: "a" } }, "test");
    const note: PushPayload = { title: "Papa needs you now", body: "…", url: "/open/a9", tag: "alert-a9", urgent: true };
    expect(await pushToUsers(db, [arjun.id, meera.id], note, { key: "alert:a9" })).toEqual({ sent: 3, failed: 0, gone: 0, skipped: 0 });

    const log = await deliveriesWith("alert:a9");
    expect(log).toHaveLength(3);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [webSub, webBody, webOptions] = sendNotification.mock.calls[0];
    expect(webSub).toMatchObject({ endpoint: "https://push.example.test/meera" });
    expect(webOptions).toEqual({ TTL: 300, urgency: "high" });
    expect(JSON.parse(webBody)).toEqual({ ...note, receipt: log.find((d) => d.endpoint === "https://push.example.test/meera")!.id });
    expect(sentMessages().map((m) => [m.token, m.data.receipt]).sort()).toEqual(
      log.filter((d) => d.endpoint.startsWith("fcm:")).map((d) => [d.endpoint.slice(4), d.id]).sort(),
    );

    // Both kinds are idempotent by the alert's key.
    sendNotification.mockClear();
    fetchMock.mockClear();
    expect(await pushToUsers(db, [arjun.id, meera.id], note, { key: "alert:a9" })).toEqual({ sent: 0, failed: 0, gone: 0, skipped: 3 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(calls(SEND_URL)).toHaveLength(0);
  });
});

describe("POST /api/push/subscribe from the Android app", () => {
  const req = (method: "POST" | "DELETE", body: unknown) =>
    new Request("http://localhost/api/push/subscribe", {
      method,
      headers: { "content-type": "application/json", "user-agent": "PauseButton Android" },
      body: JSON.stringify(body),
    });
  const ctx = { params: Promise.resolve({}) };

  it("stores the FCM token as kind 'fcm', endpoint 'fcm:<token>', and moves the phone to whoever signs in", async () => {
    const { arjun, meera } = await users();
    const token = "cAppToken:APA91bHUN-example-token";
    scope.headers = new Headers({ "x-pb-family": sessionToken(arjun.id) });
    expect((await subscribePost(req("POST", { fcmToken: token, app: "family" }), ctx)).status).toBe(200);
    const [row] = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.endpoint, `fcm:${token}`) });
    expect(row).toMatchObject({ userId: arjun.id, kind: "fcm", endpoint: `fcm:${token}`, p256dh: "", auth: "", userAgent: "PauseButton Android" });

    scope.headers = new Headers({ "x-pb-family": sessionToken(meera.id) });
    expect((await subscribePost(req("POST", { fcmToken: token, app: "family" }), ctx)).status).toBe(200);
    const moved = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.endpoint, `fcm:${token}`) });
    expect(moved).toEqual([expect.objectContaining({ userId: meera.id, kind: "fcm" })]);

    // Notifications off (or sign-out): the app forgets by the same endpoint.
    expect((await subscribeDelete(req("DELETE", { endpoint: `fcm:${token}`, app: "family" }), ctx)).status).toBe(200);
    expect(await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.endpoint, `fcm:${token}`) })).toEqual([]);
  });

  it("refuses a body that is neither a browser subscription nor a token", async () => {
    const { arjun } = await users();
    scope.headers = new Headers({ "x-pb-family": sessionToken(arjun.id) });
    expect((await subscribePost(req("POST", { fcmToken: "short", app: "family" }), ctx)).status).toBe(400);
    expect((await subscribePost(req("POST", { app: "family" }), ctx)).status).toBe(400);
  });
});
