// Fast gate: TF-IDF (word 1-2 grams + char 3-5 grams) + logistic regression.
// Trained by ml/train_gate.py, exported to src/data/gate-model.json, scored
// here in plain TypeScript. Server-only (reads the model with Node fs).
// The tokenisation below must stay identical to ml/train_gate.py.

import fs from "node:fs";
import path from "node:path";
import { normalizeForGate } from "./normalize";

export type GateResult = { probability: number; topTerms: { term: string; weight: number }[] };

type Block = { terms: string[]; idf: number[]; coef: number[] };
type ModelFile = { createdAt: string; intercept: number; word: Block; char: Block; training?: { rows?: number } };
type Lookup = Map<string, { idf: number; coef: number }>;

const TOKEN_CHAR = /[\p{L}\p{N}\p{M}]/u;
const PLACEHOLDERS = new Set(["xurl", "xhandle", "xamount", "xphone", "xnum"]);

/** Maximal runs of letter / number / mark code points. */
export function tokenize(norm: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of norm) {
    if (TOKEN_CHAR.test(ch)) {
      current += ch;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Tokens of 2+ code points, plus bigrams of all consecutive tokens. */
export function wordFeatures(norm: string): string[] {
  const tokens = tokenize(norm);
  const out = tokens.filter((t) => [...t].length >= 2);
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/** Character 3-5 grams of each token padded with one space on both sides. */
export function charFeatures(norm: string): string[] {
  const out: string[] = [];
  for (const token of tokenize(norm)) {
    const p = [...` ${token} `];
    for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= p.length; i++) out.push(p.slice(i, i + n).join(""));
  }
  return out;
}

let model: { file: ModelFile; word: Lookup; char: Lookup } | null = null;

function loadModel() {
  if (model) return model;
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(process.cwd(), "src/data/gate-model.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const file = JSON.parse(raw) as ModelFile;
  const lookup = (b: Block): Lookup => new Map(b.terms.map((t, i) => [t, { idf: b.idf[i], coef: b.coef[i] }]));
  model = { file, word: lookup(file.word), char: lookup(file.char) };
  return model;
}

/** Sublinear TF-IDF over in-vocabulary terms, L2-normalised within the block. */
function blockValues(features: string[], lookup: Lookup): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of features) if (lookup.has(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
  const values = new Map<string, number>();
  let sumSq = 0;
  for (const [term, count] of counts) {
    const v = (1 + Math.log(count)) * lookup.get(term)!.idf;
    values.set(term, v);
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  for (const [term, v] of values) values.set(term, v / norm);
  return values;
}

export function scoreGateNormalized(norm: string): GateResult | null {
  const m = loadModel();
  if (!m) return null;
  const word = blockValues(wordFeatures(norm), m.word);
  const char = blockValues(charFeatures(norm), m.char);
  let score = m.file.intercept;
  for (const [term, v] of word) score += m.word.get(term)!.coef * v;
  for (const [term, v] of char) score += m.char.get(term)!.coef * v;
  const topTerms = [...word]
    .map(([term, v]) => ({ term, weight: m.word.get(term)!.coef * v }))
    .filter((t) => t.weight > 0 && !t.term.split(" ").every((w) => PLACEHOLDERS.has(w)))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  return { probability: 1 / (1 + Math.exp(-score)), topTerms };
}

export function scoreGate(original: string): GateResult | null {
  return scoreGateNormalized(normalizeForGate(original));
}

export function gateModelInfo(): { loaded: boolean; createdAt?: string; rows?: number } {
  const m = loadModel();
  return m ? { loaded: true, createdAt: m.file.createdAt, rows: m.file.training?.rows } : { loaded: false };
}
