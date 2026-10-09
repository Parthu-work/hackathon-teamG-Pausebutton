// Runs the 5 examples and the 40-message test set through the real check and
// prints one line per message. Exits 1 if a scam is called SAFE or a genuine
// message is called SCAM, so CI can use it as a quality gate.
//
//   pnpm eval                 rules + fast-gate model, no AI
//   pnpm eval --ai haiku      Claude reads the unsure ones (needs ANTHROPIC_API_KEY)
//   pnpm eval --ai sonnet
import examples from "../src/data/examples.json";
import testSet from "../src/data/test-set.json";
import { checkMessage, type CheckOptions } from "../src/lib/check/pipeline";

const aiArg = process.argv[process.argv.indexOf("--ai") + 1];
const opts: CheckOptions =
  process.argv.includes("--ai") && (aiArg === "haiku" || aiArg === "sonnet")
    ? { ai: "auto", aiModel: aiArg, aiTimeoutMs: 15_000 }
    : { ai: "off" };

const pad = (v: unknown, n: number) => String(v).padEnd(n);

async function main() {
  console.log(`mode: ${opts.ai === "off" ? "rules + model" : `rules + model + ${opts.aiModel}`}\n`);
  for (const e of examples) {
    const r = await checkMessage(e.text, opts);
    console.log(`ex ${pad(e.id, 8)} ${pad(r.verdict, 10)} score ${pad(r.score, 4)} rules ${pad(r.rulesScore, 4)} model ${pad(r.modelScore, 4)} ${r.hardRule ?? ""}`);
  }
  let caught = 0, missed = 0, falseAlarms = 0, suspiciousGenuine = 0, aiUsed = 0;
  for (const t of testSet) {
    const r = await checkMessage(t.text, opts);
    if (r.ai.status === "ok") aiUsed++;
    const wrong = t.label === "scam" ? r.verdict === "SAFE" : r.verdict === "SCAM";
    if (t.label === "scam") {
      if (r.verdict === "SAFE") missed++;
      else caught++;
    } else if (r.verdict === "SCAM") falseAlarms++;
    else if (r.verdict === "SUSPICIOUS") suspiciousGenuine++;
    console.log(
      `${pad(t.id, 3)}${pad(t.label, 8)}${pad(t.family, 19)}${pad(r.verdict, 11)}score ${pad(r.score, 4)}rules ${pad(r.rulesScore, 4)}model ${pad(r.modelScore, 4)}ai ${pad(r.ai.status, 12)}${wrong ? "<-- WRONG" : ""}`,
    );
  }
  console.log(`\ncaught ${caught}/20 · missed ${missed} · false alarms ${falseAlarms} · genuine only suspicious ${suspiciousGenuine} · AI answered ${aiUsed}`);
  if (missed || falseAlarms) process.exit(1);
}
main();
