import { afterEach, describe, expect, it } from "vitest";
import { requireOperator } from "./operator";
import { secretFromEnv } from "./secrets";

// Settings that must be in place before a public deploy.

const saved = { OPERATOR_KEY: process.env.OPERATOR_KEY, VERCEL: process.env.VERCEL, SESSION_SECRET: process.env.SESSION_SECRET };
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const call = (key?: string) => new Request("http://localhost/api/demo/reset", { method: "POST", headers: key ? { "x-operator-key": key } : {} });

describe("operator key", () => {
  it("is not needed while OPERATOR_KEY is unset (laptop demo, CI)", () => {
    delete process.env.OPERATOR_KEY;
    expect(() => requireOperator(call())).not.toThrow();
  });

  it("is needed once OPERATOR_KEY is set", () => {
    process.env.OPERATOR_KEY = "s3cret";
    expect(() => requireOperator(call())).toThrow("operator key");
    expect(() => requireOperator(call("wrong"))).toThrow("operator key");
    expect(() => requireOperator(call("s3cre7"))).toThrow("operator key"); // same length, wrong content
    expect(() => requireOperator(call("s3cret"))).not.toThrow();
  });
});

describe("secrets", () => {
  it("uses the dev value on a laptop", () => {
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    expect(secretFromEnv("SESSION_SECRET", "dev")).toBe("dev");
  });

  it("refuses to run a deployment without one", () => {
    process.env.VERCEL = "1";
    delete process.env.SESSION_SECRET;
    expect(() => secretFromEnv("SESSION_SECRET", "dev")).toThrow("Set SESSION_SECRET");
    process.env.SESSION_SECRET = "long-random-value";
    expect(secretFromEnv("SESSION_SECRET", "dev")).toBe("long-random-value");
  });
});
