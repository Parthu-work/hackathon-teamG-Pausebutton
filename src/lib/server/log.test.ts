import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, log } from "./log";

const SECRET_TEXT = "Sir this is CBI Mumbai, transfer Rs 80,000";

afterEach(() => vi.restoreAllMocks());

describe("structured logs", () => {
  it("writes one JSON object per line with level, time and event", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.warn("push_failed", { statusCode: 500, attempts: 2, skipped: undefined });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "warn", event: "push_failed", statusCode: 500, attempts: 2 });
    expect(line).not.toHaveProperty("skipped");
    expect(new Date(line.time).toString()).not.toBe("Invalid Date");
  });

  it("never logs the bound parameters of a failed query, where message text can be", () => {
    const query = new Error(`Failed query: insert into "checks" ("shared_text") values ($1)\nparams: ${SECRET_TEXT}`);
    query.cause = Object.assign(new Error(`value too long; params: ${SECRET_TEXT}`), { code: "22001", detail: SECRET_TEXT });
    const fields = errorFields(query);
    expect(JSON.stringify(fields)).not.toContain("CBI");
    expect(fields.errorMessage).toBe('Failed query: insert into "checks" ("shared_text") values ($1)');
    expect(fields.errorCauseCode).toBe("22001");
    expect(fields.errorStack).toMatch(/^at /);
  });

  it("keeps the stack frames but not the message line the stack starts with", () => {
    const e = new Error(`boom\n${SECRET_TEXT}`);
    expect(JSON.stringify(errorFields(e))).not.toContain("CBI");
  });

  it("cuts long fields short", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("x", { note: "a".repeat(1000) });
    expect(JSON.parse(spy.mock.calls[0][0] as string).note.length).toBeLessThan(310);
  });
});
