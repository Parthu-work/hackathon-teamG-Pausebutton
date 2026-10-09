import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/gate-parity.json";
import { charFeatures, gateModelInfo, scoreGate, scoreGateNormalized, tokenize, wordFeatures } from "./gate";

describe("fast gate", () => {
  it("matches the Python scorer on the parity fixtures", () => {
    // Fixtures and model are written together by ml/train_gate.py.
    expect(gateModelInfo()).toMatchObject({ loaded: true, createdAt: fixtures.createdAt });
    expect(fixtures.messages).toHaveLength(50);
    for (const m of fixtures.messages) {
      const result = scoreGateNormalized(m.norm);
      expect(result, m.norm).not.toBeNull();
      expect(Math.abs(result!.probability - m.probability), m.norm).toBeLessThan(1e-6);
    }
  });

  it("keeps Devanagari and Telugu vowel signs inside tokens", () => {
    const sample = "आपका खाता बंद हो जाएगा। మీ ఖాతా బ్లాక్ అవుతుంది";
    expect(tokenize(sample)).toEqual(["आपका", "खाता", "बंद", "हो", "जाएगा", "మీ", "ఖాతా", "బ్లాక్", "అవుతుంది"]);
    const words = wordFeatures(sample);
    const chars = charFeatures(sample);
    expect(words.length).toBeGreaterThan(0);
    expect(chars.length).toBeGreaterThan(0);
    expect(words).toEqual(expect.arrayContaining(["खाता", "खाता बंद", "ఖాతా", "ఖాతా బ్లాక్"]));
    expect(chars).toEqual(expect.arrayContaining([" खा", "ाता ", " ఖా", "బ్లా"]));
  });

  it("scores raw text and leaves placeholders out of topTerms", () => {
    const result = scoreGate("Sir this is CBI Mumbai. Stay on the call and transfer Rs 80,000 to the verification account.");
    expect(result).not.toBeNull();
    expect(result!.probability).toBeGreaterThan(0.5);
    expect(result!.topTerms.length).toBeLessThanOrEqual(5);
    const placeholders = new Set(["xurl", "xhandle", "xamount", "xphone", "xnum"]);
    for (const t of result!.topTerms) {
      expect(t.weight).toBeGreaterThan(0);
      expect(t.term.split(" ").every((w) => placeholders.has(w)), t.term).toBe(false);
    }
  });
});
