import { describe, expect, it } from "vitest";
import examples from "@/data/examples.json";
import testSet from "@/data/test-set.json";
import { checkMessage } from "./pipeline";

// Runs the real rules and the real fast-gate model (no AI). This is the
// quality gate in CI: no scam may be called SAFE and no genuine message SCAM.

describe("demo examples match the designs", () => {
  const expected: Record<string, string> = { cbi: "SCAM", kyc: "SCAM", courier: "SUSPICIOUS", lottery: "SCAM", bank: "SAFE" };
  for (const e of examples) {
    it(`${e.label} → ${expected[e.id]}`, async () => {
      const r = await checkMessage(e.text, { ai: "off" });
      expect(r.modelScore, "fast-gate model missing: run pnpm ml:all").not.toBeNull();
      expect(r.verdict).toBe(expected[e.id]);
    });
  }
});

describe("40-message test set (rules + model, no AI)", () => {
  it("catches every scam and raises no false alarm", async () => {
    const results = await Promise.all(
      testSet.map(async (t) => ({ ...t, verdict: (await checkMessage(t.text, { ai: "off" })).verdict })),
    );
    const missed = results.filter((r) => r.label === "scam" && r.verdict === "SAFE").map((r) => r.id);
    const falseAlarms = results.filter((r) => r.label === "genuine" && r.verdict === "SCAM").map((r) => r.id);
    expect(missed, "scams called SAFE").toEqual([]);
    expect(falseAlarms, "genuine messages called SCAM").toEqual([]);
  });
});
