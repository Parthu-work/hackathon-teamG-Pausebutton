import { describe, expect, it } from "vitest";
import { findLinks, worstLink } from "./links";
import { normalizeForGate, normalizeForMatch, toOriginalSpan } from "./normalize";
import { detectFamily, findAmount, findPayee, runRules } from "./rules";
import examples from "@/data/examples.json";

const example = (id: string) => examples.find((e) => e.id === id)!.text;
const types = (text: string) => [...new Set(runRules(text).signals.map((s) => s.type))].sort();

describe("normalize", () => {
  it("undoes leet digits, look-alike letters and spaced letters", () => {
    expect(normalizeForMatch("Your acc0unt is bl0cked").text).toBe("your account is blocked");
    expect(normalizeForMatch("Update K.Y.C now").text).toBe("update kyc now");
    expect(normalizeForMatch("u r g e n t").text).toBe("urgent");
    expect(normalizeForMatch("сbi").text).toBe("cbi"); // Cyrillic с
  });

  it("keeps amounts, phone numbers and short words intact", () => {
    expect(normalizeForMatch("Pay Rs 1,850 now").text).toBe("pay rs 1,850 now");
    expect(normalizeForMatch("I am in a car").text).toBe("i am in a car");
  });

  it("maps spans back to the original text", () => {
    const original = "Please TELL  NO​ ONE about this";
    const n = normalizeForMatch(original);
    const s = n.text.indexOf("tell no one");
    const [os, oe] = toOriginalSpan(n, s, s + "tell no one".length, original);
    expect(original.slice(os, oe)).toBe("TELL  NO​ ONE");
  });

  it("replaces links, amounts and numbers for the gate", () => {
    expect(normalizeForGate("Pay Rs 1,850 at courier-clear.top or call 98765 43210")).toBe(
      "pay xamount at xurl or call xphone",
    );
  });
});

describe("signals", () => {
  it("finds all four signals in the CBI call", () => {
    const found = runRules(example("cbi")).signals;
    expect(found.map((s) => [s.type, s.phrase])).toEqual(
      expect.arrayContaining([
        ["authority", "CBI Mumbai"],
        ["fear", "illegal items"],
        ["secrecy", "Stay on the call"],
        ["secrecy", "tell no one"],
        ["payment", "transfer Rs 80,000"],
      ]),
    );
  });

  it("does not treat a bank's OTP warning as secrecy or a code request", () => {
    const r = runRules("482913 is your OTP. Do NOT share this OTP with anyone. Kisi ko na batayein.");
    expect(r.signals.filter((s) => s.type === "secrecy")).toEqual([]);
    expect(r.credential).toEqual([]);
  });

  it("flags requests for OTPs, PINs and screen-sharing apps", () => {
    expect(runRules("Please share the OTP sent to your phone").credential).toHaveLength(1);
    expect(runRules("Download the AnyDesk app now").credential).toHaveLength(1);
    expect(runRules("Scan the QR and enter your UPI PIN to receive money").credential).toHaveLength(1);
  });

  it("reads Hinglish, Hindi and Telugu phrases", () => {
    expect(types("Video call pe bane rahiye aur kisi ko mat batana. Rs 45,000 turant bhejiye.")).toEqual(
      expect.arrayContaining(["fear", "payment", "secrecy"]),
    );
    expect(types("इनाम के लिए 5,000 रुपये फीस जमा करें और किसी को न बताएं।")).toEqual(["payment", "secrecy"]);
    expect(types("మీ ఖాతా బ్లాక్ అవుతుంది")).toEqual(["fear"]);
  });

  it("finds nothing in a normal bank alert", () => {
    expect(types(example("bank"))).toEqual([]);
  });
});

describe("links", () => {
  const status = (text: string) => worstLink(findLinks(text))?.status;
  it("classifies links", () => {
    expect(status("Track at amazon.in/orders")).toBe("known");
    expect(status("Report at cybercrime.gov.in")).toBe("known");
    expect(status("Update at sbi-kyc-update.com")).toBe("blocked");
    expect(status("Update at hdfc-kyc-verify.in/update")).toBe("lookalike");
    expect(status("Visit hdfcbnak.com")).toBe("lookalike");
    expect(status("Details: courier-clear.top")).toBe("risky");
    expect(status("Click bit.ly/abc")).toBe("risky");
    expect(status("See example-shop.com")).toBe("unknown");
    expect(status("Mail me at someone@gmail.com")).toBeUndefined();
    expect(status("Rs 2,450.00 debited")).toBeUndefined();
  });
});

describe("family, amount and payee", () => {
  it("names the trick and finds the money it asks for", () => {
    const cbi = runRules(example("cbi"));
    expect(detectFamily(cbi.normalized.text)).toBe("fake_officer");
    const pay = cbi.signals.filter((s) => s.type === "payment");
    expect(findAmount(example("cbi"), pay)).toEqual({ value: 80000, text: "Rs 80,000" });
    expect(findPayee(cbi.normalized.text)).toBe("Verification Account");

    const lottery = runRules(example("lottery"));
    expect(detectFamily(lottery.normalized.text)).toBe("lottery");
    // The fee, not the prize.
    expect(findAmount(example("lottery"), lottery.signals.filter((s) => s.type === "payment"))?.value).toBe(6500);
    expect(detectFamily(runRules(example("courier")).normalized.text)).toBe("courier_fee");
    expect(detectFamily(runRules(example("kyc")).normalized.text)).toBe("bank_kyc");
  });
});
