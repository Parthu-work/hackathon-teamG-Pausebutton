import { beforeEach, describe, expect, it, vi } from "vitest";
import examples from "@/data/examples.json";

// Pin the model score so these tests check the rules and the tiers only.
const gate = vi.hoisted(() => ({ probability: null as number | null }));
vi.mock("./gate", () => ({
  scoreGate: () => (gate.probability === null ? null : { probability: gate.probability, topTerms: [{ term: "prize", weight: 1 }] }),
}));
const ai = vi.hoisted(() => ({ reading: null as unknown }));
vi.mock("./ai", () => ({
  readWithClaude: vi.fn(async () => ai.reading ?? { status: "unavailable", signals: [] }),
}));

import { checkMessage } from "./pipeline";

const example = (id: string) => examples.find((e) => e.id === id)!.text;

beforeEach(() => {
  gate.probability = null;
  ai.reading = null;
});

describe("checkMessage", () => {
  it("CBI call: hard rule (secrecy + payment) → SCAM with a hold amount", async () => {
    const r = await checkMessage(example("cbi"));
    expect(r.verdict).toBe("SCAM");
    expect(r.hardRule).toBe("secrecy_payment");
    expect(r.decidedBy).toBe("hard_rule");
    expect(r.rulesScore).toBe(80);
    expect(r.amount?.value).toBe(80000);
    expect(r.family).toBe("fake_officer");
  });

  it("bank KYC link: hard rule (bad link) → SCAM", async () => {
    const r = await checkMessage(example("kyc"));
    expect(r.verdict).toBe("SCAM");
    expect(r.hardRule).toBe("bad_link");
  });

  it("courier fee: 15 + 25 + 20 = 60% → SUSPICIOUS, rules only when the AI is missing", async () => {
    gate.probability = 0.4;
    const r = await checkMessage(example("courier"));
    expect(r.rulesScore).toBe(60);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.ai.status).toBe("unavailable");
    expect(r.degraded).toBe(true);
  });

  it("real bank alert → SAFE, no AI call", async () => {
    gate.probability = 0.05;
    const r = await checkMessage(example("bank"));
    expect(r.verdict).toBe("SAFE");
    expect(r.score).toBe(5);
    expect(r.ai.status).toBe("not_needed");
  });

  it("a confident model with at least one phrase → SCAM", async () => {
    gate.probability = 0.93;
    const r = await checkMessage(example("lottery"));
    expect(r.verdict).toBe("SCAM");
    expect(r.decidedBy).toBe("score");
  });

  it("a confident model with no phrase at all stays SUSPICIOUS", async () => {
    gate.probability = 0.93;
    const r = await checkMessage("Congratulations dear, you are selected. Reply YES.");
    expect(r.rulesScore).toBe(0);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.modelTerms).toEqual(["prize"]);
  });

  it("the AI can raise SUSPICIOUS to SCAM but never lower a verdict", async () => {
    gate.probability = 0.4;
    ai.reading = {
      status: "ok",
      model: "claude-haiku-5-5",
      label: "scam",
      signals: [{ type: "secrecy", phrase: "release it", start: 0, end: 1, by: "ai" }],
    };
    const raised = await checkMessage(example("courier"));
    expect(raised.verdict).toBe("SCAM");
    expect(raised.decidedBy).toBe("ai");

    ai.reading = { status: "ok", model: "claude-haiku-5-5", label: "safe", signals: [] };
    const kept = await checkMessage(example("courier"));
    expect(kept.verdict).toBe("SUSPICIOUS");
    expect(kept.degraded).toBe(false);
  });

  it("AI off (rules-only run) does not call Claude", async () => {
    const r = await checkMessage(example("courier"), { ai: "off" });
    expect(r.ai.status).toBe("unavailable");
  });
});
