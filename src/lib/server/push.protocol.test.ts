import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Web Push over the wire, with nothing mocked on our side: the real web-push
// library encrypts (RFC 8291, aes128gcm) and signs (VAPID, RFC 8292) every
// notification and POSTs it (RFC 8030) to a push service running here. That
// service checks the signature and decrypts the payload with the phone's
// private key, as Chrome's, Firefox's or Apple's push service and the phone
// would, and answers with whatever status a test asks for.
process.env.PGLITE_DIR = "memory";

import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import examples from "@/data/examples.json";
import { createCheck, reachForCheck, REACH_GRACE_MS } from "./checks";
import { personaUser, resetDemo } from "./demo";
import { pushToUsers, recordReceipt, saveSubscription, type PushPayload } from "./push";

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");
const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

/** A phone: its push keys, as a browser makes them for pushManager.subscribe(). */
function phone() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { ecdh, publicKey: ecdh.getPublicKey(), auth: crypto.randomBytes(16) };
}
type Phone = ReturnType<typeof phone>;

/** What the phone does with a push: RFC 8291 decryption of a single aes128gcm record. */
function decrypt(body: Buffer, p: Phone): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ecdhSecret = p.ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(p.auth, ecdhSecret), Buffer.concat([Buffer.from("WebPush: info\0"), p.publicKey, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  // Padding: the last record ends with 0x02 and then zeros.
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  expect(plain[end]).toBe(2);
  return plain.subarray(0, end).toString("utf8");
}

/** What the push service checks before it accepts anything: the VAPID JWT and key. */
function verifyVapid(authorization: string | undefined) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(authorization ?? "");
  expect(m, `Authorization: ${authorization}`).toBeTruthy();
  const [, jwt, k] = m!;
  const [h, p, s] = jwt.split(".");
  const raw = unb64u(k);
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: "jwk" });
  const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, unb64u(s));
  return { ok, header: JSON.parse(unb64u(h).toString()), claims: JSON.parse(unb64u(p).toString()), key: k };
}

type Received = { path: string; headers: Record<string, string | string[] | undefined>; body: Buffer };
let server: https.Server;
let origin = "";
const received: Received[] = [];
/** Status codes the next requests get (then 201). */
const replies: { status: number; headers?: Record<string, string> }[] = [];

const vapid = webpush.generateVAPIDKeys();
const text = (id: string) => examples.find((e) => e.id === id)!.text;
let db: Db;
let tmp = "";

beforeAll(async () => {
  // A throwaway certificate for the local push service, trusted only by this test's requests.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-push-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem"),
  ], { stdio: "ignore" });
  const cert = fs.readFileSync(path.join(tmp, "cert.pem"));
  server = https.createServer({ key: fs.readFileSync(path.join(tmp, "key.pem")), cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      const reply = replies.shift() ?? { status: 201 };
      res.writeHead(reply.status, reply.headers).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  (https.globalAgent.options as https.AgentOptions).ca = cert;

  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "mailto:ops@pause.test";
  db = await getDb();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete (https.globalAgent.options as https.AgentOptions).ca;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDemo(db);
  await db.delete(schema.pushSubscriptions);
  received.length = 0;
  replies.length = 0;
});

/** Registers a phone for a person, with an endpoint on the local push service. */
async function register(userId: string, name: string) {
  const p = phone();
  await saveSubscription(db, userId, { endpoint: `${origin}/push/${name}`, keys: { p256dh: b64u(p.publicKey), auth: b64u(p.auth) } }, "test");
  return p;
}

describe("Web Push on the wire (RFC 8030, 8291, 8292)", () => {
  it("an urgent alert is signed, encrypted for that phone only, and marked high urgency with a short TTL", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    const meera = (await personaUser(db, "meera"))!;
    const phoneA = await register(arjun.id, "arjun");
    const phoneM = await register(meera.id, "meera");
    const payload: PushPayload = { title: "Papa needs you now", body: "Nothing is paid.", url: "/open/a1", tag: "alert-a1", urgent: true };
    expect(await pushToUsers(db, [arjun.id], payload, { key: "wire:urgent" })).toEqual({ sent: 1, failed: 0, gone: 0, skipped: 0 });

    expect(received).toHaveLength(1);
    const [r] = received;
    expect(r.path).toBe("/push/arjun");
    expect(r.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "300", urgency: "high" });
    const v = verifyVapid(r.headers.authorization as string);
    expect(v.ok).toBe(true);
    expect(v.header).toMatchObject({ typ: "JWT", alg: "ES256" });
    expect(v.key).toBe(vapid.publicKey);
    expect(v.claims.aud).toBe(origin);
    expect(v.claims.sub).toBe("mailto:ops@pause.test");
    expect(v.claims.exp * 1000).toBeGreaterThan(Date.now());
    expect(v.claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000);

    // Arjun's phone reads it, with the receipt id of its own delivery row; Meera's keys cannot.
    const [row] = await db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, "wire:urgent") });
    expect(JSON.parse(decrypt(r.body, phoneA))).toEqual({ ...payload, receipt: row.id });
    expect(() => decrypt(r.body, phoneM)).toThrow();
  });

  it("a quiet heads-up has normal urgency and lives for an hour", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    await register(arjun.id, "arjun");
    await pushToUsers(db, [arjun.id], { title: "Heads-up", body: "", url: "/open/a2", tag: "alert-a2", urgent: false }, { key: "wire:quiet" });
    expect(received[0].headers).toMatchObject({ ttl: "3600", urgency: "normal" });
  });

  it("follows what the push service answers: 429 then 201 is sent on the second try; 410 forgets the phone; 500 twice is a failure", async () => {
    const arjun = (await personaUser(db, "arjun"))!;
    await register(arjun.id, "arjun");
    const note: PushPayload = { title: "x", body: "", url: "/family", tag: "t", urgent: true };

    replies.push({ status: 429, headers: { "retry-after": "0" } });
    expect(await pushToUsers(db, [arjun.id], note, { key: "wire:busy", retryDelayMs: 1 })).toMatchObject({ sent: 1 });
    expect(received).toHaveLength(2);
    expect((await db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, "wire:busy") }))[0]).toMatchObject({ status: "sent", attempts: 2 });

    replies.push({ status: 500 }, { status: 500 });
    expect(await pushToUsers(db, [arjun.id], note, { key: "wire:down", retryDelayMs: 1 })).toMatchObject({ sent: 0, failed: 1 });
    expect((await db.query.pushDeliveries.findMany({ where: eq(schema.pushDeliveries.key, "wire:down") }))[0]).toMatchObject({ status: "failed", statusCode: 500, attempts: 2 });

    replies.push({ status: 410 });
    expect(await pushToUsers(db, [arjun.id], note, { key: "wire:gone" })).toMatchObject({ gone: 1 });
    expect(await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, arjun.id) })).toEqual([]);
  });

  it("end to end: Papa pastes a scam, Arjun's phone decrypts the alert, and its receipt tells Papa's screen he was reached", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const arjun = (await personaUser(db, "arjun"))!;
    const phoneA = await register(arjun.id, "arjun");
    // Meera has no phone set up: only Arjun's push goes out.
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect(received.map((r) => r.path)).toEqual(["/push/arjun"]);

    const alert = JSON.parse(decrypt(received[0].body, phoneA)) as PushPayload;
    expect(alert).toMatchObject({ title: "Papa needs you now", urgent: true, kind: "urgent", checkId, holdId, url: expect.stringMatching(/^\/open\//) });
    expect(alert.actions?.map((a) => a.action)).toEqual(["block", "fine"]);

    // The service worker's receipt, as sw.js sends it.
    await recordReceipt(db, alert.receipt!, true);
    await db.update(schema.alerts).set({ createdAt: new Date(Date.now() - REACH_GRACE_MS - 1_000) }).where(eq(schema.alerts.checkId, checkId));
    expect(await reachForCheck(db, checkId)).toEqual({ unreachableNames: ["Meera"], nobodyReached: false });
  });
});
