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

describe("real messages that once got SCAM", () => {
  for (const text of [
    "123456 is your OTP for login. SBI never asks you to share your OTP with anyone.",
    "Bank officials will never ask you to share the OTP.",
    "Do not ever share your OTP. HDFC Bank",
    "Your PNR 4521 is confirmed. Live status: https://trainman.in/pnr/4521",
    "Photos from the wedding: https://s3.amazonaws.com/rao-family/album.zip",
    "Your appointment at praxis.com is on Monday 10am.",
    "Your prints are ready at kodak.com, pick up any time.",
    "New kurta collection at mantra.com, see you there!",
  ]) {
    it(text, async () => {
      expect((await checkMessage(text, { ai: "off" })).verdict).not.toBe("SCAM");
    });
  }
});

describe("scam messages that must stay SCAM", () => {
  for (const text of [
    "Do not call anyone\nShare the OTP now",
    "Bank officials never call\nShare the OTP with me now",
    "Dear customer, your HDFC netbanking statement is ready. Login at hdfcbank.net",
    "ICICI Bank: Your cashback of Rs 1,500 is credited. Check at icicibank.co/cashback",
    "Axis Bank: Your KYC is pending. Complete at axisbank-kyc.com to avoid service interruption",
    "SBI YONO: Rs 2,000 cashback credited to your account. View at yonosbi.in",
    "Your IRCTC tatkal ticket is confirmed. Download at irctctatkal.com",
    "Big Billion Days! iPhone at 90% off only today at flipkartsale.com",
  ]) {
    it(text.replace("\n", " / "), async () => {
      expect((await checkMessage(text, { ai: "off" })).verdict).toBe("SCAM");
    });
  }

  it("SBI's own yono.sbi is not a fake", async () => {
    expect((await checkMessage("Login to YONO at yono.sbi for your statement", { ai: "off" })).verdict).not.toBe("SCAM");
  });
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
