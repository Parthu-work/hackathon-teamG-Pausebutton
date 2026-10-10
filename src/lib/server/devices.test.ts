import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory";

import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import examples from "@/data/examples.json";
import { personaUser, resetDemo } from "./demo";
import { assetLinks, createPairing, deviceByToken, deviceInbox, disconnectDevice, listDevices, pairDevice, removeDevice, setDeviceStatus, watchSettings } from "./devices";
import { familyState } from "./state";

let db: Db;
beforeAll(async () => {
  db = await getDb();
  await resetDemo(db);
});

describe("the Android message watcher", () => {
  it("pairs with a code, then posts real messages that are checked and alert the family", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const arjun = (await personaUser(db, "arjun"))!;
    const pairing = await createPairing(db, rao, "https://pause.example.com");
    expect(pairing.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(pairing.link).toBe(`pausebutton://pair?code=${pairing.code}&host=https%3A%2F%2Fpause.example.com`);
    expect((await listDevices(db, rao)).map((d) => d.paired)).toEqual([false]);

    const { token, userName } = await pairDevice(db, pairing.code.toLowerCase(), "Pixel 7");
    expect(userName).toBe("Mr Rao");
    await expect(pairDevice(db, pairing.code, "again")).rejects.toThrow("did not work"); // one use only
    await expect(deviceByToken(db, "Bearer nope")).rejects.toThrow("no longer connected");
    await expect(deviceByToken(db, null)).rejects.toThrow("not connected");

    const { device, user } = await deviceByToken(db, `Bearer ${token}`);
    expect(user.id).toBe(rao.id);
    await setDeviceStatus(db, device, { listenerOn: true });

    const row = await deviceInbox(db, device, user, {
      channel: "whatsapp",
      sender: "+91 9XXXX XXXXX",
      fromContact: false,
      text: examples.find((e) => e.id === "cbi")!.text,
    });
    expect(row.checkId).toBeTruthy();
    const check = (await db.query.checks.findFirst({ where: eq(schema.checks.id, row.checkId!) }))!;
    expect(check.verdict).toBe("SCAM");
    expect(check.source).toBe("whatsapp");
    expect((await familyState(db, arjun)).alerts.map((a) => a.kind)).toEqual(["headsup"]);

    const [view] = await listDevices(db, rao);
    expect(view).toMatchObject({ name: "Pixel 7", paired: true, online: true, listenerOn: true, messagesSeen: 1 });
    expect(view.lastMessageAt).toBeTruthy();

    // A message from a saved contact is skipped when "only unknown senders" is on.
    const skipped = await deviceInbox(db, device, user, { channel: "sms", sender: "Meera", fromContact: true, text: "Papa, dinner at 8?" });
    expect(skipped.checkId).toBeNull();

    await removeDevice(db, rao, view.id);
    await expect(deviceByToken(db, `Bearer ${token}`)).rejects.toThrow("no longer connected");
  });

  it("the phone learns what to leave out, and can disconnect itself so the web app forgets it", async () => {
    const rao = (await personaUser(db, "rao"))!;
    expect(watchSettings(rao)).toEqual({ watchSms: true, watchWhatsapp: true, unknownOnly: true });
    await db.update(schema.users).set({ watchWhatsapp: false, unknownOnly: false }).where(eq(schema.users.id, rao.id));
    const changed = (await personaUser(db, "rao"))!;
    expect(watchSettings(changed)).toEqual({ watchSms: true, watchWhatsapp: false, unknownOnly: false });

    const pairing = await createPairing(db, rao, "https://pause.example.com");
    const { token } = await pairDevice(db, pairing.code, "Pixel 8");
    const { device, user } = await deviceByToken(db, `Bearer ${token}`);
    await disconnectDevice(db, device, user);
    await expect(deviceByToken(db, `Bearer ${token}`)).rejects.toThrow("no longer connected");
    expect((await listDevices(db, rao)).some((d) => d.name === "Pixel 8")).toBe(false);
    const events = await db.query.events.findMany({ where: eq(schema.events.householdId, rao.id) });
    expect(events.some((e) => e.message === "Mr Rao's Android phone (Pixel 8) disconnected itself")).toBe(true);
    await db.update(schema.users).set({ watchWhatsapp: true, unknownOnly: true }).where(eq(schema.users.id, rao.id));
  });

  it("a message the phone posts twice under one id is checked and counted once; its 30-minute sync reports in", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const pairing = await createPairing(db, rao, "https://pause.example.com");
    const { token } = await pairDevice(db, pairing.code, "Pixel 9");
    const { device, user } = await deviceByToken(db, `Bearer ${token}`);
    const msg = { channel: "sms" as const, sender: "VM-COURIER", fromContact: false, text: examples.find((e) => e.id === "courier")!.text };
    const key = "2f6c1c9e-4b1a-4d2e-9f00-5a1b2c3d4e5f";
    const first = await deviceInbox(db, device, user, msg, key);
    const again = await deviceInbox(db, device, user, msg, key);
    expect(first).toMatchObject({ status: "checked", duplicate: false });
    expect(again).toEqual({ ...first, duplicate: true });
    const mine = () => listDevices(db, rao).then((ds) => ds.find((d) => d.name === "Pixel 9")!);
    expect((await mine()).messagesSeen).toBe(1);

    expect((await mine()).lastSyncAt).toBeNull();
    const synced = await setDeviceStatus(db, device, { listenerOn: true, waiting: 4, sync: true });
    expect(synced).toMatchObject({ listenerOn: true, waiting: 4 });
    expect(await mine()).toMatchObject({ listenerOn: true, waiting: 4, lastSyncAt: expect.any(String), notSyncing: false });
    await removeDevice(db, rao, (await mine()).id);
  });

  it("an expired code cannot pair", async () => {
    const rao = (await personaUser(db, "rao"))!;
    const pairing = await createPairing(db, rao, "https://pause.example.com");
    await db.update(schema.devices).set({ pairingExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.devices.pairingCode, pairing.code));
    await expect(pairDevice(db, pairing.code, "late")).rejects.toThrow("did not work");
  });

  it("asset links list the app only when a signing fingerprint is configured", () => {
    delete process.env.ANDROID_CERT_SHA256;
    expect(assetLinks()).toEqual([]);
    process.env.ANDROID_CERT_SHA256 = "aa:bb, cc:dd";
    expect(assetLinks()).toEqual([
      { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "ai.apty.pausebutton", sha256_cert_fingerprints: ["AA:BB", "CC:DD"] } },
    ]);
    delete process.env.ANDROID_CERT_SHA256;
  });
});
