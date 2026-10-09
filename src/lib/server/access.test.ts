import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// W1 · abuse and access control: rate limits, operator-only reads, the demo
// sign-in switch and un-blocking a domain. Route handlers run for real against
// an in-memory Postgres; only Next's request scope is stood in for.
process.env.PGLITE_DIR = "memory";

const scope = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => scope.headers,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
// While `stub` is on, a stand-in replaces the checker, so a test can count
// what reached it (and the Anthropic API behind it). The demo seed uses the real one.
const checker = vi.hoisted(() => ({ stub: false, calls: 0 }));
vi.mock("./checks", async (orig) => {
  const real = await orig<typeof import("./checks")>();
  return {
    ...real,
    createCheck: async (...args: Parameters<typeof real.createCheck>) => {
      if (!checker.stub) return real.createCheck(...args);
      checker.calls++;
      return { checkId: "c", verdict: "SAFE" };
    },
  };
});

import { getDb, type Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { POST as checksPost } from "@/app/api/me/checks/route";
import { GET as demoGet, POST as demoPost } from "@/app/api/auth/demo/route";
import { POST as signInPost } from "@/app/api/auth/sign-in/route";
import { GET as campaignsGet } from "@/app/api/ops/campaigns/route";
import { GET as disagreementsGet } from "@/app/api/ops/disagreements/route";
import { GET as familiesGet } from "@/app/api/ops/families/route";
import { GET as reportsGet } from "@/app/api/ops/reports/route";
import { POST as reviewPost } from "@/app/api/ops/reports/[id]/route";
import { GET as testsLatestGet } from "@/app/api/tests/latest/route";
import { personaUser, resetDemo } from "./demo";
import { rateLimit, TOO_MANY } from "./ratelimit";
import { liveBlockedDomains, reviewDomain, seedReport } from "./reports";
import { demoSignInOpen, sessionToken } from "./session";

const HOST_VARS = ["VERCEL", "RAILWAY_ENVIRONMENT_NAME", "RENDER", "FLY_APP_NAME", "K_SERVICE", "DEPLOYED"];
const saved = Object.fromEntries(["OPERATOR_KEY", "DEMO_SIGNIN", ...HOST_VARS].map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  scope.headers = new Headers();
});

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const req = (path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
beforeEach(async () => {
  checker.stub = false;
  checker.calls = 0;
  await resetDemo(db); // also clears the rate-limit counters
});

describe("rate limits", () => {
  const call = (ip: string) => req("/api/me/checks", { body: {}, headers: { "x-real-ip": ip } });

  it("lets a person through up to the limit, then refuses with a plain message and Retry-After", async () => {
    const now = new Date("2026-10-10T10:00:00Z");
    for (let i = 0; i < 10; i++) await rateLimit(db, call("1.1.1.1"), "check", "user-a", now);
    const over = rateLimit(db, call("1.1.1.1"), "check", "user-a", now);
    await expect(over).rejects.toMatchObject({ status: 429, message: TOO_MANY, retryAfter: 60 });
    // Someone else, from another address, is not affected.
    await expect(rateLimit(db, call("2.2.2.2"), "check", "user-b", now)).resolves.toBeUndefined();
  });

  it("starts a new window once the old one ends", async () => {
    const now = new Date("2026-10-10T10:00:00Z");
    for (let i = 0; i < 11; i++) await rateLimit(db, call("1.1.1.1"), "check", "user-a", now).catch(() => {});
    await expect(rateLimit(db, call("1.1.1.1"), "check", "user-a", new Date(now.getTime() + 30_000))).rejects.toMatchObject({ status: 429 });
    await expect(rateLimit(db, call("1.1.1.1"), "check", "user-a", new Date(now.getTime() + 61_000))).resolves.toBeUndefined();
  });

  it("limits one address across many people", async () => {
    const now = new Date("2026-10-10T10:00:00Z");
    for (let i = 0; i < 30; i++) await rateLimit(db, call("9.9.9.9"), "check", `user-${i}`, now);
    await expect(rateLimit(db, call("9.9.9.9"), "check", "user-new", now)).rejects.toMatchObject({ status: 429 });
  });

  it("stores no raw IP address", async () => {
    await rateLimit(db, call("203.0.113.7"), "check", "user-a");
    const keys = (await db.select().from(schema.rateLimits)).map((r) => r.key);
    expect(keys.join(" ")).not.toContain("203.0.113.7");
  });

  it("hammering POST /api/me/checks gets a 429 before the checker (and the Anthropic API) is reached", async () => {
    const rao = (await personaUser(db, "rao"))!;
    scope.headers = new Headers({ "x-pb-rao": sessionToken(rao.id) });
    checker.stub = true;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await checksPost(req("/api/me/checks", { body: { text: `Is this real? ${i}` } }), ctx());
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(checker.calls).toBe(10);
    const res = await checksPost(req("/api/me/checks", { body: { text: "one more" } }), ctx());
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await res.json()).error).toBe(TOO_MANY);
  });

  it("throttles demo sign-in per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await demoPost(req("/api/auth/demo", { body: { persona: "rao" } }), ctx())).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
  });

  it("throttles code guesses per mobile number", async () => {
    const guess = (ip: string) => signInPost(req("/api/auth/sign-in", { body: { phone: "98765 00001", code: "0000" }, headers: { "x-real-ip": ip } }), ctx());
    for (let i = 0; i < 5; i++) expect((await guess(`10.0.0.${i}`)).status).toBe(400);
    expect((await guess("10.0.0.99")).status).toBe(429);
  });
});

describe("operator-only reads", () => {
  const reads = { campaigns: campaignsGet, disagreements: disagreementsGet, families: familiesGet, reports: reportsGet, "tests/latest": testsLatestGet };

  it.each(Object.entries(reads))("%s needs the operator key once OPERATOR_KEY is set", async (_, GET) => {
    process.env.OPERATOR_KEY = "s3cret";
    expect((await GET(req("/api/ops/x"), ctx())).status).toBe(401);
    expect((await GET(req("/api/ops/x", { headers: { "x-operator-key": "wrong!" } }), ctx())).status).toBe(401);
    expect((await GET(req("/api/ops/x", { headers: { "x-operator-key": "s3cret" } }), ctx())).status).toBe(200);
  });

  it.each(Object.entries(reads))("%s stays open on a laptop without OPERATOR_KEY", async (_, GET) => {
    delete process.env.OPERATOR_KEY;
    expect((await GET(req("/api/ops/x"), ctx())).status).toBe(200);
  });
});

describe("demo sign-in switch", () => {
  it("is on for a laptop or CI, off on any deployment, and DEMO_SIGNIN decides when set", () => {
    delete process.env.DEMO_SIGNIN;
    HOST_VARS.forEach((name) => delete process.env[name]);
    expect(demoSignInOpen()).toBe(true);
    for (const host of ["VERCEL", "RAILWAY_ENVIRONMENT_NAME", "DEPLOYED"]) {
      process.env[host] = "1";
      expect(demoSignInOpen()).toBe(false);
      delete process.env[host];
    }
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    process.env.DEMO_SIGNIN = "on";
    expect(demoSignInOpen()).toBe(true);
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.DEMO_SIGNIN = "off";
    expect(demoSignInOpen()).toBe(false);
  });

  it("when off, nobody can become Mr Rao: neither the demo buttons nor the 1234 code work", async () => {
    process.env.DEMO_SIGNIN = "off";
    const demo = await demoPost(req("/api/auth/demo", { body: { persona: "rao" } }), ctx());
    expect(demo.status).toBe(403);
    const rao = (await personaUser(db, "rao"))!;
    const signIn = await signInPost(req("/api/auth/sign-in", { body: { phone: rao.phone, code: "1234" } }), ctx());
    expect(signIn.status).toBe(403);
    expect(await (await demoGet(req("/api/auth/demo"), ctx())).json()).toEqual({ open: false });
  });
});

describe("un-blocking a domain", () => {
  it("a domain blocked in error comes off the live blocklist from /reports", async () => {
    await seedReport(db, { domain: "my-real-shop.in", reportedByName: "Test" });
    const row = (await db.query.reportedDomains.findFirst({ where: (r, { eq }) => eq(r.domain, "my-real-shop.in") }))!;
    await reviewDomain(db, row.id, "block");
    expect(await liveBlockedDomains(db)).toContain("my-real-shop.in");
    const res = await reviewPost(req(`/api/ops/reports/${row.id}`, { body: { decision: "unblock" } }), ctx({ id: row.id }));
    expect(await res.json()).toEqual({ domain: "my-real-shop.in", status: "unblocked" });
    expect(await liveBlockedDomains(db)).not.toContain("my-real-shop.in");
  });

  it("refuses to un-block a domain that is not blocked", async () => {
    await seedReport(db, { domain: "never-blocked.in", reportedByName: "Test" });
    const row = (await db.query.reportedDomains.findFirst({ where: (r, { eq }) => eq(r.domain, "never-blocked.in") }))!;
    await expect(reviewDomain(db, row.id, "unblock")).rejects.toThrow("not blocked");
  });

  it("still never blocks an official bank domain", async () => {
    await seedReport(db, { domain: "onlinesbi.sbi", reportedByName: "Test" });
    const row = (await db.query.reportedDomains.findFirst({ where: (r, { eq }) => eq(r.domain, "onlinesbi.sbi") }))!;
    await expect(reviewDomain(db, row.id, "block")).rejects.toThrow("never be blocked");
  });
});
