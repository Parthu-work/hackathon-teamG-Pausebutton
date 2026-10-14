import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A1 sign-in codes and A2 the name at sign-up: a random 4-digit code that
// works once, for 5 minutes, with 5 tries, 30 s between requests, shown on
// screen only by the demo sender and only while demo sign-in is on. The
// otp module runs against an in-memory Postgres; the route handlers run for
// real with only Next's request scope (and its cookie jar) stood in for.
process.env.PGLITE_DIR = "memory";

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

import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { formatPhone } from "@/lib/phone";
import { POST as codePost } from "@/app/api/auth/code/route";
import { GET as offerGet } from "@/app/api/auth/demo/route";
import { POST as rolePost } from "@/app/api/auth/role/route";
import { POST as signInPost } from "@/app/api/auth/sign-in/route";
import { PATCH as familySettingsPatch } from "@/app/api/family/settings/route";
import { PATCH as raoSettingsPatch } from "@/app/api/me/settings/route";
import { issueCode, OTP_EXPIRED, OTP_FORMAT, OTP_LOCKED, OTP_NONE, OTP_WRONG, sweepOtpCodes, verifyCode } from "./otp";
import { TOO_MANY } from "./ratelimit";
import { sessionToken } from "./session";

const saved = Object.fromEntries(["DEMO_SIGNIN", "OTP_PROVIDER"].map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  scope.cookies.clear();
  vi.useRealTimers();
});

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
beforeEach(async () => {
  await db.delete(schema.rateLimits); // each test starts with fresh rate-limit counters
});

// Every test signs in with a number of its own, so no code or counter carries over.
let n = 0;
const newNumber = () => formatPhone(String(9_870_000_000 + ++n))!;
/** A 4-digit code that is not `code`. */
const otherThan = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, "0");
const codesOf = (phone: string) => db.query.otpCodes.findMany({ where: eq(schema.otpCodes.phone, phone) });

const ctx = { params: Promise.resolve({}) };
const post = (path: string, body: unknown, ip = "10.9.0.1") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });
const askCode = async (phone: string, ip?: string) => codePost(post("/api/auth/code", { phone }, ip), ctx);
const signIn = async (phone: string, code: string, ip?: string) => signInPost(post("/api/auth/sign-in", { phone, code }, ip), ctx);

describe("sign-in codes (otp.ts)", () => {
  it("are 4 random digits, kept only as an HMAC, and work exactly once", async () => {
    const phone = newNumber();
    const { code } = await issueCode(db, phone);
    expect(code).toMatch(/^\d{4}$/);
    const [row] = await codesOf(phone);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/); // an HMAC-SHA256, never the digits
    expect(Object.values(row)).not.toContain(code);
    await expect(verifyCode(db, phone, code)).resolves.toBeUndefined();
    await expect(verifyCode(db, phone, code)).rejects.toMatchObject({ status: 400, message: OTP_NONE });
    // Random, not one fixed demo code.
    const many = await Promise.all(Array.from({ length: 12 }, () => issueCode(db, newNumber())));
    expect(new Set(many.map((c) => c.code)).size).toBeGreaterThan(1);
  });

  it("Resend retires the old code: only the newest one works", async () => {
    const phone = newNumber();
    const t0 = new Date();
    const first = await issueCode(db, phone, t0);
    const second = await issueCode(db, phone, new Date(t0.getTime() + 31_000));
    const rows = await codesOf(phone);
    expect(rows.find((r) => r.id === first.id)?.consumedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === second.id)?.consumedAt).toBeNull();
    // (One time in 10,000 the new code has the same digits; then the old digits are simply the new code.)
    if (first.code !== second.code) {
      await expect(verifyCode(db, phone, first.code, new Date(t0.getTime() + 32_000))).rejects.toMatchObject({ message: OTP_WRONG });
    }
    await expect(verifyCode(db, phone, second.code, new Date(t0.getTime() + 33_000))).resolves.toBeUndefined();
  });

  it("expire after 5 minutes", async () => {
    const t0 = new Date();
    const early = newNumber();
    const late = newNumber();
    const a = await issueCode(db, early, t0);
    const b = await issueCode(db, late, t0);
    await expect(verifyCode(db, early, a.code, new Date(t0.getTime() + 4 * 60_000 + 59_000))).resolves.toBeUndefined();
    await expect(verifyCode(db, late, b.code, new Date(t0.getTime() + 5 * 60_000))).rejects.toMatchObject({ status: 400, message: OTP_EXPIRED });
    expect(OTP_EXPIRED).toBe("That code has expired. Tap Resend.");
  });

  it("lock after 5 wrong tries, and then even the right code does not work", async () => {
    const phone = newNumber();
    const { code } = await issueCode(db, phone);
    for (let i = 0; i < 4; i++) await expect(verifyCode(db, phone, otherThan(code))).rejects.toMatchObject({ message: OTP_WRONG });
    await expect(verifyCode(db, phone, otherThan(code))).rejects.toMatchObject({ message: OTP_LOCKED });
    await expect(verifyCode(db, phone, code)).rejects.toMatchObject({ message: OTP_LOCKED });
    expect(OTP_LOCKED).toBe("Too many tries. Ask for a new code.");
  });

  it("do not count a slip (too few digits, a letter) as a try", async () => {
    const phone = newNumber();
    const { code } = await issueCode(db, phone);
    for (const slip of ["12", "12345", "12a4", "", "1 2 3"]) {
      await expect(verifyCode(db, phone, slip)).rejects.toMatchObject({ status: 400, message: OTP_FORMAT });
    }
    expect((await codesOf(phone))[0].attempts).toBe(0);
    await expect(verifyCode(db, phone, ` ${code} `)).resolves.toBeUndefined();
  });

  it("can be asked for again only after 30 s: before that a 429 says how many seconds are left", async () => {
    const phone = newNumber();
    const t0 = new Date();
    await issueCode(db, phone, t0);
    await expect(issueCode(db, phone, new Date(t0.getTime() + 10_000))).rejects.toMatchObject({
      status: 429,
      retryAfter: 20,
      message: "Please wait 20 seconds before asking for a new code.",
    });
    await expect(issueCode(db, phone, new Date(t0.getTime() + 29_500))).rejects.toMatchObject({
      retryAfter: 1,
      message: "Please wait 1 second before asking for a new code.",
    });
    await expect(issueCode(db, phone, new Date(t0.getTime() + 30_000))).resolves.toMatchObject({ code: expect.stringMatching(/^\d{4}$/) });
  });

  it("are swept a day later", async () => {
    const phone = newNumber();
    const t0 = new Date("2026-10-01T10:00:00Z");
    await issueCode(db, phone, t0);
    expect(await sweepOtpCodes(db, new Date(t0.getTime() + 23 * 3600_000))).toBe(0);
    expect(await sweepOtpCodes(db, new Date(t0.getTime() + 25 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect(await codesOf(phone)).toHaveLength(0);
  });
});

describe("POST /api/auth/code and /api/auth/sign-in", () => {
  it("demo mode: the code comes back in that one answer, is marked shown, and signs a new number in once", async () => {
    process.env.DEMO_SIGNIN = "on";
    const phone = newNumber();
    const res = await askCode(phone.replace("+91 ", ""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ phone, demoCode: expect.stringMatching(/^\d{4}$/) });
    expect(new Date(body.expiresAt).getTime() - new Date(body.serverNow).getTime()).toBe(5 * 60_000);
    expect(new Date(body.resendAt).getTime() - new Date(body.serverNow).getTime()).toBe(30_000);
    expect((await codesOf(phone))[0].shownAt).toBeInstanceOf(Date);

    const ok = await signIn(phone, body.demoCode);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ redirect: "/role" });
    expect(scope.cookies.has("pb_pending")).toBe(true);
    const again = await signIn(phone, body.demoCode);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe(OTP_NONE);
  });

  it("a second request inside 30 s is a 429 with the seconds left and Retry-After", async () => {
    process.env.DEMO_SIGNIN = "on";
    const phone = newNumber();
    expect((await askCode(phone)).status).toBe(200);
    const res = await askCode(phone);
    expect(res.status).toBe(429);
    const wait = Number(res.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(30);
    expect(await res.json()).toEqual({ error: `Please wait ${wait} seconds before asking for a new code.` });
  });

  it("tapping Send again and again inside the 30 s wait uses up none of the 5 requests a number has", async () => {
    process.env.DEMO_SIGNIN = "on";
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-10T10:00:00Z");
    vi.setSystemTime(t0);
    const phone = newNumber();
    expect((await askCode(phone)).status).toBe(200);
    for (let i = 1; i <= 8; i++) {
      vi.setSystemTime(new Date(t0.getTime() + i * 1000));
      const res = await askCode(phone);
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe(`Please wait ${30 - i} seconds before asking for a new code.`);
    }
    // Then four more codes, each after its wait: all five requests were still there.
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(new Date(t0.getTime() + i * 31_000));
      expect((await askCode(phone)).status).toBe(200);
    }
  });

  it("with demo sign-in off no code is handed out, and neither route works (403)", async () => {
    process.env.DEMO_SIGNIN = "off";
    const phone = newNumber();
    const res = await askCode(phone);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sign-in is not open on this site yet." });
    expect(await codesOf(phone)).toHaveLength(0);
    // Not even a code issued while it was on.
    const { code } = await issueCode(db, phone);
    expect((await signIn(phone, code)).status).toBe(403);
    expect(await (await offerGet(new Request("http://localhost/api/auth/demo"), ctx)).json()).toEqual({ open: false, codes: "off" });
  });

  it("OTP_PROVIDER=sms answers 503 until SMS is set up, hands out no code, and a failed send does not hold up the next request", async () => {
    process.env.OTP_PROVIDER = "sms";
    process.env.DEMO_SIGNIN = "off";
    const phone = newNumber();
    for (let i = 0; i < 2; i++) {
      const res = await askCode(phone);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toMatch(/demoCode/);
    }
    expect((await codesOf(phone)).every((r) => r.consumedAt)).toBe(true);
    expect(await (await offerGet(new Request("http://localhost/api/auth/demo"), ctx)).json()).toEqual({ open: false, codes: "sms" });
  });

  it("asking for a code and trying one are limited apart: the 5-try lock comes first, and a new code then still works", async () => {
    process.env.DEMO_SIGNIN = "on";
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-10T09:00:00Z");
    vi.setSystemTime(t0);
    const phone = newNumber();
    const first = await (await askCode(phone)).json();
    const tries: { status: number; error: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await signIn(phone, otherThan(first.demoCode));
      tries.push({ status: res.status, error: (await res.json()).error });
    }
    expect(tries.map((t) => t.status)).toEqual([400, 400, 400, 400, 400]);
    expect(tries.at(-1)!.error).toBe(OTP_LOCKED);
    // "Ask for a new code": after the 30 s wait it comes, and it works.
    vi.setSystemTime(new Date(t0.getTime() + 31_000));
    const second = await askCode(phone);
    expect(second.status).toBe(200);
    expect((await signIn(phone, (await second.json()).demoCode)).status).toBe(200);
  });

  it("limits each number to 5 code requests and, apart from those, 10 tries in 10 minutes, from any address", async () => {
    process.env.DEMO_SIGNIN = "on";
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-10T11:00:00Z");
    const phone = newNumber();
    const asked: number[] = [];
    let last = "";
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(new Date(t0.getTime() + i * 31_000)); // past the 30 s wait each time
      const res = await askCode(phone, `10.9.1.${i}`);
      asked.push(res.status);
      if (res.status === 200) last = (await res.json()).demoCode;
      else expect((await res.json()).error).toBe(TOO_MANY);
    }
    expect(asked).toEqual([200, 200, 200, 200, 200, 429]);
    // Asking used none of the tries: 10 are still answered on the code itself (wrong, then locked), the 11th is throttled.
    const tried: number[] = [];
    for (let i = 0; i < 11; i++) tried.push((await signIn(phone, otherThan(last), `10.9.2.${i}`)).status);
    expect(tried).toEqual([...Array(10).fill(400), 429]);
  });
});

describe("A2 · the name at sign-up (POST /api/auth/role)", () => {
  /** A new number, signed in with its code: the phone holds a pending session. */
  async function pendingSignUp() {
    process.env.DEMO_SIGNIN = "on";
    const phone = newNumber();
    const { demoCode } = await (await askCode(phone)).json();
    expect(await (await signIn(phone, demoCode)).json()).toEqual({ redirect: "/role" });
    return (await db.query.users.findFirst({ where: eq(schema.users.phone, phone) }))!;
  }
  const role = (body: unknown) => rolePost(post("/api/auth/role", body), ctx);

  it("refuses a missing, blank or placeholder name with 400", async () => {
    const user = await pendingSignUp();
    expect(user.name).toBe("Guest");
    for (const body of [{ role: "protected" }, { role: "protected", name: "" }, { role: "protected", name: "   " }, { role: "family", name: "Guest" }]) {
      const res = await role(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Please enter your name.");
    }
    expect((await role({ role: "protected", name: "x".repeat(41) })).status).toBe(400);
    expect(scope.cookies.has("pb_pending")).toBe(true);
  });

  it("takes \"Ramesh\": the account is his, and the phone is signed in as Mr Rao's app", async () => {
    const user = await pendingSignUp();
    const res = await role({ role: "protected", name: "  Ramesh " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/setup" });
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, user.id) })).toMatchObject({ name: "Ramesh", role: "protected" });
    expect(scope.cookies.get("pb_rao")).toBe(sessionToken(user.id));
    expect(scope.cookies.has("pb_pending")).toBe(false);
  });

  it("needs a pending sign-in", async () => {
    const res = await role({ role: "family", name: "Arjun" });
    expect(res.status).toBe(401);
  });
});

describe("an account from before the name was asked for (still \"Guest\")", () => {
  /** An old account: it has a role, so sign-in goes straight home and never asks for the name. */
  async function oldAccount(role: "protected" | "family") {
    process.env.DEMO_SIGNIN = "on";
    const phone = newNumber();
    const { demoCode } = await (await askCode(phone)).json();
    await signIn(phone, demoCode);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.phone, phone) }))!;
    await db.update(schema.users).set({ role, name: "Guest" }).where(eq(schema.users.id, user.id));
    scope.cookies.clear();
    const again = await askCode(phone, "10.9.0.7");
    const res = await signIn(phone, (await again.json()).demoCode, "10.9.0.7");
    expect(await res.json()).toEqual({ redirect: role === "protected" ? "/" : "/family" });
    return user;
  }
  const patch = (handler: typeof raoSettingsPatch, path: string, body: unknown) =>
    handler(new Request(`http://localhost${path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);

  it("Mr Rao's home can save his real name, and never \"Guest\" again", async () => {
    const user = await oldAccount("protected");
    expect((await patch(raoSettingsPatch, "/api/me/settings", { name: "guest" })).status).toBe(400);
    expect((await patch(raoSettingsPatch, "/api/me/settings", { name: "  Varun " })).status).toBe(200);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.name).toBe("Varun");
  });

  it("a family member's home can save theirs too", async () => {
    const user = await oldAccount("family");
    expect((await patch(familySettingsPatch, "/api/family/settings", { name: "" })).status).toBe(400);
    expect((await patch(familySettingsPatch, "/api/family/settings", { name: "Madhav" })).status).toBe(200);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.name).toBe("Madhav");
  });
});
