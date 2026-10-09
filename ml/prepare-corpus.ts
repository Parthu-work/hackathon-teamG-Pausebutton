// Builds the fast-gate training corpus.  Run: pnpm tsx ml/prepare-corpus.ts
//
// Reads ml/build/raw_combined.jsonl (from ml/download.py) and the team seeds,
// normalises every row with the app's own normalizeForGate, and writes:
//   ml/build/corpus.jsonl       {norm, label, lang, source}
//   ml/build/eval_inputs.jsonl  {id, kind, norm, label, family}  (app test set + examples)
//   ml/build/prepare_stats.json counts of what was kept and dropped
//
// Rows that equal or nearly equal (Jaccard >= 0.8 on word sets) any app test
// message or example are removed, as are exact duplicates, exact duplicates
// with conflicting labels, and near duplicates of rows already kept.

import fs from "node:fs";
import path from "node:path";
import { normalizeForGate } from "../src/lib/check/normalize";
import { tokenize } from "../src/lib/check/gate";

type Row = { norm: string; label: number; lang: string; source: string };

const ROOT = process.cwd();
const BUILD = path.join(ROOT, "ml/build");
const NEAR_DUP = 0.8;
// Seeds are kept first, then the more varied dataset, then the templated one.
const PRIORITY = ["team_seeds", "synthetic_audited", "scam_ham_india_14"];

const readJsonl = (file: string) =>
  fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const writeJsonl = (file: string, rows: object[]) =>
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

// Seeds mask phone numbers ("+91 9XXXX XXXXX"). Give them dummy digits so the
// normaliser emits "xphone" as it would for a real number, instead of "xxxxx".
const unmask = (text: string) =>
  text.replace(/([6-9])X{4}[\s-]?X{5}/g, "$10000 00000").replace(/1800[\s-]?X{3}[\s-]?X{4}/g, "1800 000 0000");

/** Index of word sets that answers "is there a kept set with Jaccard >= 0.8?". */
class NearDupIndex {
  private postings = new Map<string, number[]>();
  private sizes: number[] = [];
  private keys: (string | number)[] = [];

  add(words: Set<string>, key: string | number) {
    const id = this.sizes.length;
    this.sizes.push(words.size);
    this.keys.push(key);
    for (const w of words) {
      const list = this.postings.get(w);
      if (list) list.push(id);
      else this.postings.set(w, [id]);
    }
  }

  find(words: Set<string>): string | number | undefined {
    const shared = new Map<number, number>();
    for (const w of words) for (const id of this.postings.get(w) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1);
    for (const [id, n] of shared) if (n / (words.size + this.sizes[id] - n) >= NEAR_DUP) return this.keys[id];
    return undefined;
  }
}

function main() {
  const rawFile = path.join(BUILD, "raw_combined.jsonl");
  if (!fs.existsSync(rawFile)) throw new Error("ml/build/raw_combined.jsonl is missing; run pnpm ml:download first");

  // ---- evaluation messages (never trained on) ----
  const testSet = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/test-set.json"), "utf8"));
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/examples.json"), "utf8"));
  const evalInputs = [
    ...testSet.map((t: { id: number; family: string; label: string; text: string }) => ({
      id: String(t.id), kind: "test", norm: normalizeForGate(t.text), label: t.label === "scam" ? 1 : 0, family: t.family,
    })),
    // examples.json has a display title, not a verdict; the genuine one is titled "Real bank alert".
    ...examples.map((e: { id: string; label: string; text: string }) => ({
      id: e.id, kind: "example", norm: normalizeForGate(e.text), label: /real|genuine|safe/i.test(e.label) ? 0 : 1, family: e.label,
    })),
  ];
  const evalIndex = new NearDupIndex();
  const evalNorms = new Set<string>();
  for (const e of evalInputs) {
    evalIndex.add(new Set(tokenize(e.norm)), `${e.kind}:${e.id}`);
    evalNorms.add(e.norm);
  }

  // ---- candidate rows in priority order ----
  const seeds = readJsonl(path.join(ROOT, "ml/seeds/team_seeds.jsonl")).map((s) => ({
    text: unmask(s.text), label: s.label, lang: s.lang, source: "team_seeds",
  }));
  const candidates: { text: string; label: number; lang: string; source: string }[] = [...seeds, ...readJsonl(rawFile)];
  candidates.sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));

  const dropped: Record<string, number> = { empty: 0, exactDuplicate: 0, labelConflict: 0, evalOverlap: 0, nearDuplicate: 0 };
  const evalHits: Record<string, number> = {};
  const byNorm = new Map<string, Row | null>(); // null = conflicting labels
  const kept: Row[] = [];
  const corpusIndex = new NearDupIndex();

  for (const c of candidates) {
    const norm = normalizeForGate(c.text);
    const words = new Set(tokenize(norm));
    if (words.size === 0) {
      dropped.empty++;
      continue;
    }
    const evalMatch = evalNorms.has(norm) ? "exact" : evalIndex.find(words);
    if (evalMatch !== undefined) {
      dropped.evalOverlap++;
      const key = String(evalMatch);
      evalHits[key] = (evalHits[key] ?? 0) + 1;
      continue;
    }
    if (byNorm.has(norm)) {
      const first = byNorm.get(norm);
      if (first && first.label !== c.label) {
        byNorm.set(norm, null);
        dropped.labelConflict++;
      } else dropped.exactDuplicate++;
      continue;
    }
    const row: Row = { norm, label: c.label, lang: c.lang, source: c.source };
    byNorm.set(norm, row);
    if (corpusIndex.find(words) !== undefined) {
      dropped.nearDuplicate++;
      continue;
    }
    corpusIndex.add(words, kept.length);
    kept.push(row);
  }

  // Drop the first occurrence of any text that later appeared with the other label.
  const corpus = kept.filter((r) => byNorm.get(r.norm) !== null);
  dropped.labelConflict += kept.length - corpus.length;

  const counts: Record<string, number> = {};
  for (const r of corpus) {
    const key = `${r.source}|${r.lang}|${r.label ? "scam" : "safe"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const inputBySource: Record<string, number> = {};
  for (const c of candidates) inputBySource[c.source] = (inputBySource[c.source] ?? 0) + 1;

  fs.mkdirSync(BUILD, { recursive: true });
  writeJsonl(path.join(BUILD, "corpus.jsonl"), corpus);
  writeJsonl(path.join(BUILD, "eval_inputs.jsonl"), evalInputs);
  const stats = { input: candidates.length, inputBySource, kept: corpus.length, dropped, evalHits, counts };
  fs.writeFileSync(path.join(BUILD, "prepare_stats.json"), JSON.stringify(stats, null, 2) + "\n");

  console.log(`input rows: ${candidates.length} ${JSON.stringify(inputBySource)}`);
  console.log(`dropped: ${JSON.stringify(dropped)}`);
  console.log(`rows removed for overlapping app test/example messages: ${JSON.stringify(evalHits)}`);
  console.log(`corpus rows: ${corpus.length}`);
  for (const [key, n] of Object.entries(counts).sort()) console.log(`  ${key.padEnd(40)} ${n}`);
  console.log(`wrote ml/build/corpus.jsonl and ml/build/eval_inputs.jsonl (${evalInputs.length} eval messages)`);
}

main();
