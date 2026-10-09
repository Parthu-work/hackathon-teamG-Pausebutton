import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The real Claude reader against a fake API on localhost. Whatever Claude
// replies, a reading that fails must fall back to rules only, never fail the check.

let reply = { text: "", stop_reason: "end_turn" };
let server: http.Server;
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: reply.text }],
          stop_reason: reply.stop_reason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  for (const [name, value] of [["ANTHROPIC_API_KEY", saved.key], ["ANTHROPIC_BASE_URL", saved.url]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// SUSPICIOUS on rules and the model, so Claude is asked.
const COURIER = "Hi, your parcel has reached the customs counter. Please pay Rs 1,850 fee at courier-clear.top so we can deliver it tomorrow.";

describe("Claude reader fallback", () => {
  it("a reply cut off at max_tokens gives the rules-only verdict", async () => {
    reply = { text: '{"signals":[{"type":"payment","phr', stop_reason: "max_tokens" };
    const { checkMessage } = await import("./pipeline");
    const r = await checkMessage(COURIER);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.ai.status).toBe("error");
    expect(r.degraded).toBe(true);
  });

  it("a refusal in plain text gives the rules-only verdict", async () => {
    reply = { text: "I can't help with that.", stop_reason: "refusal" };
    const { checkMessage } = await import("./pipeline");
    const r = await checkMessage(COURIER);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.ai.status).toBe("error");
  });

  it("a reading that did not end normally is not trusted, even when it parses", async () => {
    reply = { text: JSON.stringify({ signals: [], scam_type: "none", label: "safe" }), stop_reason: "max_tokens" };
    const { checkMessage } = await import("./pipeline");
    const r = await checkMessage(COURIER);
    expect(r.ai.status).toBe("error");
    expect(r.degraded).toBe(true);
  });

  it("a good reading can still raise the verdict", async () => {
    reply = { text: JSON.stringify({ signals: [], scam_type: "fake courier fee", label: "scam" }), stop_reason: "end_turn" };
    const { checkMessage } = await import("./pipeline");
    const r = await checkMessage(COURIER);
    expect(r.ai.status).toBe("ok");
    expect(r.verdict).toBe("SCAM");
    expect(r.decidedBy).toBe("ai");
  });
});
