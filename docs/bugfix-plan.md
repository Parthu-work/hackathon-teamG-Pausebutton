# Pause Button: bug-fix plan for Phase 1

**For:** a coding agent working in this repository.
**Base:** `main` at commit `983ad9f` ("phase-1:implementation").
**Goal:** fix the 12 confirmed bugs and 7 spec and deploy gaps found in the audit, each with a regression test, and change nothing else.

**Status of this plan:** every change below was applied to a scratch copy of commit `983ad9f` and run there (it was not committed). With all of them in place:

- `pnpm lint` and the type check pass;
- `pnpm test` passes 64 tests (the 35 existing ones and 29 new ones);
- `pnpm build` passes;
- `pnpm e2e` passes 6 tests (the 3 existing ones and 3 new ones);
- every new test fails on the current code;
- the 40-message results do not move: all 20 scams still get SCAM, and no genuine message gets SCAM.

The code in this plan is the code that passed. Copy it as written.

## How to hand this over

Give the agent this prompt:

> Implement `docs/bugfix-plan.md` in this repository, task by task, in the order given. Follow the ground rules in section 1. Run each task's checks before you commit it, and commit each task with the message the plan gives. If a check fails and the plan does not say what to do, stop and report the failing output.

---

## 1. Ground rules

1. Read `AGENTS.md` first. This is Next.js 16. None of these changes need a Next.js API the code doesn't already use, so don't add one.
2. Change only what this plan lists. Don't do any of these:
   - refactor, rename or reformat other code;
   - add or upgrade dependencies;
   - retrain the model (`ml/`, `src/data/gate-model.json`);
   - change the database schema or migrations (`drizzle/`);
   - change the points or score bands in `src/lib/check/config.ts`.
3. Never delete, skip or weaken an existing test or assertion. The 35 existing unit tests and 3 browser tests must keep passing unchanged.
4. Line numbers refer to commit `983ad9f` and move as you edit. Find code by the quoted snippets.
5. Match the code around you:
   - short comments that say why;
   - double quotes and 2-space indents;
   - the existing helpers (`HttpError`, `route`, `readBody`, `logEvent`, `userNames`).

   Screen text and error messages are short, calm, plain sentences for a 71-year-old. Never show a percentage on Mr Rao's screens.
6. Run the task's checks before each commit and use the commit message given.
   - Work on the branch your environment gives you. If it gives none, create `fix/phase-1-bugs` from `main`.
   - Never push to `main`.
   - Open a pull request only if asked.

## 2. Setup and baseline

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm next typegen && pnpm typecheck
pnpm test                # expect: 5 test files, 35 tests pass
pnpm build
pnpm e2e                 # expect: 3 tests pass (uses the build above)
pnpm eval > /tmp/eval-before.txt; tail -1 /tmp/eval-before.txt
# expect: caught 20/20 · missed 0 · false alarms 0 · genuine only suspicious 2 · AI answered 0
```

If `pnpm e2e` fails with "Executable doesn't exist", Playwright has no browser.

- Run `pnpm exec playwright install chromium`.
- If downloads are blocked but a Chromium is already installed, point a temporary copy of `playwright.config.ts` at it with `use.launchOptions.executablePath` and run `pnpm exec playwright test --config <that copy>`.

CI installs its own browser, so commit none of this. Rebuild (`pnpm build`) before every `pnpm e2e` run, because the browser tests run against the production build.

## 3. Overview

| Task | What it fixes | Files | New tests |
|---|---|---|---|
| T1 | A cut-off or refused Claude reply crashes the check instead of falling back to rules | `src/lib/check/ai.ts` | `src/lib/check/ai.test.ts` (3) |
| T2 | Family decisions don't stick: a second answer overwrites the first; an expired hold can be approved; "Pay anyway" undoes a Block; the newest advice is shown, not the first | `src/lib/server/checks.ts`, `src/lib/server/holds.ts`, `src/screens/rao/verdict.tsx`, `src/screens/rao/evidence.tsx`, `src/screens/family/screens.tsx` | `src/lib/server/flow.test.ts` (4) |
| T3 | Checker false alarms and wrong amounts: bank OTP warnings, ordinary links, phone numbers read as rupees | `src/lib/check/rules.ts`, `src/lib/check/links.ts` | `src/lib/check/rules.test.ts` (4), `src/lib/check/eval.test.ts` (8) |
| T4 | Data integrity: "Delete my history" deletes a live hold; one person can take two codes; two people can take one code | `src/lib/server/checks.ts`, `src/lib/server/people.ts`, `src/app/api/me/checks/route.ts`, `src/screens/rao/history.tsx`, `src/screens/family/screens.tsx` | `src/lib/server/flow.test.ts` (3) |
| T5 | A scam with no amount (the "Bank KYC link" sample) vanishes from Arjun's home | `src/screens/family/screens.tsx` | `e2e/two-phones.spec.ts` (1) |
| T6 | Spec rules: percentages on "Why we think so"; phone numbers not checked and duplicates allowed; no warning when removing the last linked person | `src/screens/rao/evidence.tsx`, `src/lib/phone.ts` (new), `src/lib/server/schemas.ts`, `src/lib/server/people.ts`, `src/screens/rao/people.tsx` | `src/lib/server/flow.test.ts` (1), `e2e/two-phones.spec.ts` (2) |
| T7 | Before a public deploy: operator routes are open, including paid Claude runs; built-in fallback secrets; guessable 4-character codes; "today" uses the server's time zone | `src/lib/server/operator.ts` (new), `src/lib/server/secrets.ts` (new), 5 route files, `src/lib/client/api.ts`, `src/screens/operator.tsx`, `src/screens/family/screens.tsx`, `src/lib/server/session.ts`, `src/lib/server/checks.ts`, `src/lib/server/state.ts`, `src/lib/check/config.ts`, `src/lib/server/people.ts`, `README.md`, `.env.example` | `src/lib/server/deploy.test.ts` (4), `src/lib/server/flow.test.ts` (2) |

After all tasks: 64 unit tests in 7 files, and 6 browser tests.

---

## T1. A failed Claude reading falls back to rules only

**Bug.** `readWithClaude` in `src/lib/check/ai.ts` (lines 85–91) only catches `APIError` and `APIConnectionError`. When Claude's structured reply can't be parsed, the SDK's `messages.parse` throws a plain `AnthropicError`, which the code throws again. That happens when the reply is cut off at `max_tokens`, or when it is a refusal in plain text. The chain is:

1. `checkMessage` rejects.
2. `POST /api/me/checks` returns 500.
3. Mr Rao sees "Something went wrong" instead of the rules-only verdict.

The refusal check on line 74 never runs for a text refusal, because the parse throws first.

The "/tests → Run on Sonnet" button is the most exposed. Sonnet 5.5 thinks by default (the code turns thinking off only for Haiku), and the thinking counts toward `max_tokens: 800`. One cut-off reply fails the whole 40-message run.

**Change** `src/lib/check/ai.ts` in three places.

1. Give Sonnet room to think. Replace `max_tokens: 800,` with:

   ```ts
           // Sonnet 5.5 thinks before it answers, and thinking counts toward max_tokens.
           max_tokens: modelKey === "haiku" ? 1024 : 8192,
   ```

2. Treat anything but a normal end as a failed reading. Replace `if (response.stop_reason === "refusal" || !response.parsed_output) {` with:

   ```ts
       if (response.stop_reason !== "end_turn" || !response.parsed_output) {
   ```

3. Widen the catch, keeping the timeout branch first. The whole `catch` becomes:

   ```ts
     } catch (error) {
       if (error instanceof Anthropic.APIConnectionTimeoutError) return { status: "timeout", model, signals: [] };
       // HTTP and network errors, and replies that do not fit the schema (cut off
       // at max_tokens, or a refusal in plain text): fall back to rules only.
       if (error instanceof Anthropic.AnthropicError) {
         console.warn(`[ai] ${model} failed:`, error.message);
         return { status: "error", model, signals: [] };
       }
       throw error;
     }
   ```

   `Anthropic.AnthropicError` is the SDK's base error class. `APIError`, `APIConnectionError` and the parse failure all extend it.

**Test.** Create `src/lib/check/ai.test.ts`. It runs the real reader against a fake Claude API on localhost, so it needs no network and no key.

```ts
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

  it("a good reading can still raise the verdict", async () => {
    reply = { text: JSON.stringify({ signals: [], scam_type: "fake courier fee", label: "scam" }), stop_reason: "end_turn" };
    const { checkMessage } = await import("./pipeline");
    const r = await checkMessage(COURIER);
    expect(r.ai.status).toBe("ok");
    expect(r.verdict).toBe("SCAM");
    expect(r.decidedBy).toBe("ai");
  });
});
```

The `checkMessage` import is dynamic on purpose. `ai.ts` creates its client on first use, so the fake URL must be set before that happens.

**Done when:**

- `pnpm vitest run src/lib/check/ai.test.ts` passes 3 of 3 (on the old code the first two fail);
- `pnpm test` is green: 38 tests.

**Commit:** `fix(check): fall back to rules when Claude's reply is cut off or refused`

---

## T2. Family decisions stick

### T2a. The first answer to a question wins

**Bug.** `setFamilyVerdict` (`src/lib/server/checks.ts:160`) overwrites any earlier answer. If Arjun answers "It's a scam" and Meera then answers "This is not a scam", Papa sees "This is not a scam. You can carry on." The spec says a second decision is refused.

**Change** `setFamilyVerdict`: update only while no answer exists, and refuse otherwise. Replace the doc comment, and the plain `await db.update(...).where(eq(schema.checks.id, checkId));`, with:

```ts
/** Family answers a heads-up or "Ask" request: "It's a scam" / "This is not a scam". The first answer wins. */
export async function setFamilyVerdict(db: Db, member: User, checkId: string, verdict: "scam" | "not_scam", note?: string) {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) throw new HttpError(404, "That message was not found.");
  await assertLinked(db, member, check.userId);
  const [answered] = await db
    .update(schema.checks)
    .set({ familyVerdict: verdict, familyVerdictBy: member.id, familyVerdictAt: new Date() })
    .where(and(eq(schema.checks.id, checkId), isNull(schema.checks.familyVerdict)))
    .returning();
  if (!answered) {
    // Like a hold decision: a later "not a scam" must never undo "it's a scam".
    const current = (await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) })) ?? check;
    const names = await userNames(db, [current.familyVerdictBy ?? ""]);
    const who = (current.familyVerdictBy && names[current.familyVerdictBy]) || "Someone";
    throw new HttpError(409, `${who} already answered: ${current.familyVerdict === "scam" ? "it is a scam" : "it is not a scam"}.`);
  }
```

Leave the rest of the function as it is: the advice insert, the alert update and `logEvent`. The note is stored only after a successful answer.

**Screen** (`src/screens/family/screens.tsx`, `FamilyCheckScreen`). The `answer` mutation has no error handler, so a refused answer fails silently. Add `onError` after `onSuccess`:

```ts
    // Someone else answered first: their answer stands and shows on this screen.
    onError: async (e) => {
      toast({ title: "Already answered", sub: e.message, icon: "warn", tone: "red" });
      await queryClient.invalidateQueries({ queryKey: ["family-check", id] });
    },
```

### T2b. An expired hold can be blocked, never approved

**Bug.** `decideHold` (`src/lib/server/holds.ts:100`) approves a hold even after its 10 minutes are up. The family's expired screen also shows an Approve button (`src/screens/family/screens.tsx:410`). The spec says an expired hold never releases the money; Block must still work.

**Change** `src/lib/server/holds.ts`:

- Import `gt`: `import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";` (`asc` is for T2d).
- In `decideHold`, replace the update and the start of the `if (!updated)` block with:

```ts
  const status = decision === "block" ? "blocked" : "approved";
  const open = and(eq(schema.holds.id, holdId), eq(schema.holds.status, "pending"));
  const [updated] = await db
    .update(schema.holds)
    .set({ status, decidedById: member.id, decidedAt: new Date() })
    // Block still works after the 10 minutes. Approve does not: an expired hold never releases the money.
    .where(decision === "approve" ? and(open, gt(schema.holds.expiresAt, new Date())) : open)
    .returning();
  if (!updated) {
    const current = (await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId) })) ?? hold;
    if (current.status === "pending") {
      throw new HttpError(409, "Time ran out, so this payment can no longer be approved. You can still block it.");
    }
```

Keep the existing "already decided" message after it, unchanged. The existing flow test expects "Arjun already blocked".

**Screen** (`FamilyHoldScreen`, the `status === "expired"` branch only):

- Change `<Screen overlay={confirm && <ApproveSheet ... />}>` to plain `<Screen>`.
- Delete the line `<button className="btn line sm-btn" onClick={() => setConfirm(true)}>Approve (I know this payment)</button>`. It is the one right after the Block button that has no `disabled` attribute.

Do not touch the pending screen's Approve button. The existing browser test uses it.

### T2c. A block is final: "Pay anyway" can't undo it

**Bug.** After Arjun blocks a payment, Mr Rao still sees "Pay anyway (demo)" (`src/screens/rao/verdict.tsx:145`, `:190`). Tapping it calls `openPayment` (`src/lib/server/checks.ts:145`), which only reuses a *pending* hold. So it:

- creates a new 10-minute hold;
- alerts the family again (alerts go from 2 to 4);
- shows the new pending hold on the check, so the block is forgotten.

The spec says E1 has no "I still want to pay".

**Change** `openPayment` in `src/lib/server/checks.ts`. Replace the `existing` lookup with this, and return the hold's status in both return statements:

```ts
  const check = await ownCheck(db, owner, checkId);
  if (!check.amount) throw new HttpError(400, "This message does not ask for an amount.");
  // Family's decision sticks: a blocked payment stays blocked, and an open or
  // approved hold is reused. Only a hold he cancelled himself can start again.
  const latest = await db.query.holds.findFirst({
    where: eq(schema.holds.checkId, check.id),
    orderBy: desc(schema.holds.createdAt),
  });
  if (latest?.status === "blocked") {
    const names = await userNames(db, [latest.decidedById ?? ""]);
    const who = (latest.decidedById && names[latest.decidedById]) || "Your family";
    throw new HttpError(409, `${who} blocked this payment. It cannot be paid.`);
  }
  if (latest && latest.status !== "cancelled") return { holdId: latest.id, status: holdStatus(latest) };
  const hold = await createHold(db, check, owner);
  // ... the existing logEvent, linkedFamily and sendAlerts lines stay as they are ...
  return { holdId: hold.id, status: holdStatus(hold) };
```

**Screens:**

- `src/screens/rao/verdict.tsx`: show "Pay anyway (demo)" only when there is no hold yet, or when Mr Rao cancelled his own hold. For a pasted scam with an amount, the hold already exists, so the button never shows (the E1 spec).
  - SCAM branch: `{c.amount && c.hold?.status !== "pending" && (` becomes `{c.amount && (!c.hold || c.hold.status === "cancelled") && (`
  - SUSPICIOUS branch: `{c.amount && c.familyVerdict !== "not_scam" && c.hold?.status !== "pending" && (` becomes `{c.amount && c.familyVerdict !== "not_scam" && (!c.hold || c.hold.status === "cancelled") && (`
- `src/screens/rao/evidence.tsx` (`PayScreen`). If the payment page opens on a hold that is already decided or expired, go to that hold's screen instead of showing "Locking the payment…" forever.
  - Add `import type { HoldStatus } from "@/lib/views";`
  - Type the mutation as `post<{ holdId: string; status: HoldStatus }>(...)`.
  - Change the effect to:

```ts
    open.mutate(undefined, {
      onSuccess: async (r) => {
        // A hold that is already decided or out of time has its own screen (H3–H5).
        if (r.status !== "pending") router.replace(`/hold/${r.holdId}`);
        await queryClient.invalidateQueries({ queryKey: ["check", id] });
      },
    });
  }, [open, id, queryClient, router]);
```

A blocked payment returns 409. The lock card already shows `open.error.message`, so no more UI is needed.

### T2d. Mr Rao sees the first advice

**Bug.** `adviceFor` (`src/lib/server/holds.ts:38`) sorts newest first, and every screen shows `advice[0]`. If Meera replies after Arjun, Papa sees Meera's advice. The spec says the first reply is shown.

**Change:**

```ts
/** Oldest first: Mr Rao's screens show advice[0], the first reply. */
export async function adviceFor(db: Db, where: { checkId?: string; holdId?: string }): Promise<AdviceView[]> {
  const rows = await db.query.advice.findMany({
    where: where.holdId ? eq(schema.advice.holdId, where.holdId) : eq(schema.advice.checkId, where.checkId!),
    orderBy: asc(schema.advice.createdAt),
  });
```

### T2 tests

In `src/lib/server/flow.test.ts`, extend the holds import:

```ts
import { addAdvice, decideHold, holdStatus, toHoldView } from "./holds";
```

Append at the end of the file:

```ts
describe("family decisions stick", () => {
  it("the first answer to a question wins", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { checkId } = await createCheck(db, rao, { text: text("courier"), source: "paste" });
    await askFamily(db, rao, checkId);
    await setFamilyVerdict(db, arjun, checkId, "scam", "It is a scam. Do not pay or reply.");
    await expect(setFamilyVerdict(db, meera, checkId, "not_scam", "I checked. This one is fine.")).rejects.toThrow("Arjun already answered");
    const view = await getCheckView(db, checkId, { ownerId: rao.id });
    expect(view.familyVerdict).toBe("scam");
    expect(view.familyVerdictByName).toBe("Arjun");
    expect(view.advice.map((a) => a.fromName)).toEqual(["Arjun"]);
  });

  it("an expired hold can be blocked but never approved", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await db.update(schema.holds).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.holds.id, holdId!));
    await expect(decideHold(db, arjun, holdId!, "approve", true)).rejects.toThrow("Time ran out");
    expect((await decideHold(db, arjun, holdId!, "block", false)).status).toBe("blocked");
  });

  it("after a block, paying anyway is refused and nobody is alerted again", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const { checkId, holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await decideHold(db, arjun, holdId!, "block", false);
    const alertCount = async () => (await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId) })).length;
    const before = await alertCount();
    await expect(openPayment(db, rao, checkId)).rejects.toThrow("Arjun blocked this payment");
    expect(await alertCount()).toBe(before);
    expect((await getCheckView(db, checkId, { ownerId: rao.id })).hold?.status).toBe("blocked");
  });

  it("Mr Rao sees the first advice, not the latest", async () => {
    await resetDemo(db);
    const { rao, arjun, meera } = await users();
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    await addAdvice(db, arjun, { holdId: holdId! }, "Papa, hang up.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await addAdvice(db, meera, { holdId: holdId! }, "Stay on the phone with me.");
    const hold = (await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId!) }))!;
    expect((await toHoldView(db, hold)).advice[0]).toMatchObject({ fromName: "Arjun", text: "Papa, hang up." });
  });
});
```

**Done when:**

- `pnpm test` is green: 42 tests (the 4 new tests fail on the old code);
- the existing tests still pass unchanged, including "paying anyway locks the payment and alerts family" (a pending hold is still reused) and "Arjun already blocked";
- `pnpm lint` and the type check pass.

**Commit:** `fix(holds): first family decision wins, expired holds never approve, a block is final`

---

## T3. Checker accuracy

### T3a. A bank's "never share your OTP" line is not a code request

**Bug.** The OTP/PIN hard rule (`src/lib/check/rules.ts:60`) only skips a negation in the single word right before the verb. Each of these real bank warnings gets SCAM (`hardRule: credential_request`):

- "123456 is your OTP for login. SBI never asks you to share your OTP with anyone."
- "Bank officials will never ask you to share the OTP."
- "Do not ever share your OTP. HDFC Bank"

Pasted, each one triggers STOP and an urgent family alert. A curly apostrophe ("Don’t share your OTP") is also missed.

**Change** `src/lib/check/rules.ts`:

1. In the first `CREDENTIAL` pattern, change the lookbehind `n'?t` to `n['’]?t`: `(?<!(?:not|never|n['’]?t|nt|na|mat|nahi) )`.
2. Right after the `CREDENTIAL` array, add:

```ts
// A bank's safety line, not a request: "SBI never asks you to share your OTP",
// "Do not ever share your PIN", "No one from the bank will ask you to install AnyDesk".
const NEGATED = new RegExp(
  B +
    String.raw`(?:never|not|don['’]?t|doesn['’]?t|won['’]?t|shouldn['’]?t|can['’]?t|cannot|nobody|no ?one(?: from(?: [\p{L}\p{N}]+){1,3})?|mat|nahi)` +
    String.raw`(?: (?:will|would|shall|should|ever|kabhi|bhi))*` +
    String.raw`(?: (?:ask|asks|asked|request|requests|requested|call|calls|message|messages|need|needs|want|wants)(?: (?:you|customers|anyone))?(?: to)?)?` +
    String.raw`(?: (?:install|download|use|open))? ?$`,
  "u",
);

/** True when the words just before a request, in the same clause, negate it. */
function negated(text: string, start: number) {
  const clause = text.slice(Math.max(0, start - 80), start).split(/[.!?,;:]/u).pop() ?? "";
  return NEGATED.test(clause);
}
```

3. In `runRules`, make this the first line of the `CREDENTIAL` loop:

```ts
  for (const m of text.matchAll(CREDENTIAL)) {
    if (negated(text, m.index!)) continue;
```

The pattern only accepts a negation followed by "asking" words that run straight into the request. So "Don't panic, share the OTP" and "Don't worry just share the OTP" are still flagged. Keep this design: a missed scam costs more than a false alarm.

### T3b. Ordinary links are not "fake sites"

**Bug.** In `classify` (`src/lib/check/links.ts:73`), a brand name anywhere inside a word marks the link as a lookalike, which forces SCAM through the `bad_link` hard rule. `nearOfficial` (`:96`) does the same for any word within 2 edits of a 5-letter official name. All of these currently get SCAM:

- `trainman.in` (contains "trai")
- `s3.amazonaws.com` (contains "amazon")
- `praxis.com` (contains "axis")
- `kodak.com` ("looks like" kotak)
- `mantra.com` ("looks like" myntra)

**New rule:**

| Link | Result |
|---|---|
| A brand as a whole word (`hdfc-kyc-verify.in`) | Lookalike, as now |
| Up to 2 edits from an official name of 8 or more letters (`hdfcbnak.com`) | Lookalike, as now |
| A brand inside a longer word, plus a phishing word or an odd ending (`hdfcnetbanking-login.com`, `flipkartsale.xyz`) | Lookalike |
| A brand inside a longer word, alone (`s3.amazonaws.com`) | Risky: 20 warning points, not a hard rule |
| One edit from a short official name (`kodak.com`) | Risky |
| "trai" and "axis" inside a longer word (`trainman`, `praxis`) | Not a match: they are parts of everyday words |

**Change** `src/lib/check/links.ts`.

1. Add above `SHORTENERS`:

```ts
// Brand names that are also parts of everyday words ("train", "taxis"): only a
// whole word counts for these.
const WORD_LIKE = new Set(["trai", "axis"]);

// Words that, next to a brand name, show the site is fishing for logins or codes.
const PHISHING_WORDS = [
  "kyc", "verify", "verif", "update", "secure", "login", "signin", "netbanking", "banking", "support",
  "care", "reward", "refund", "cashback", "bonus", "claim", "prize", "account", "helpline", "unblock",
  "activate", "gift", "otp", "offer",
];
```

2. In `classify`, replace everything from `const brand = ...` up to (not including) the `ODD_TLDS` line with:

```ts
  const brand = BRANDS.find((b) => words.includes(b));
  if (brand) {
    return {
      status: "lookalike",
      reason: `It uses the name “${brand.toUpperCase()}” but is not their official site.`,
    };
  }
  const near = nearOfficial(labels[0]);
  if (near?.close) return { status: "lookalike", reason: `It looks like ${near.site} but is spelled differently.` };
  // A brand inside a longer word is proof only with a phishing word or an odd
  // ending ("hdfcnetbanking-login.com"). Alone it can be an ordinary site
  // ("s3.amazonaws.com"), so it is only a warning sign.
  const inside = BRANDS.find((b) => b.length >= 4 && !WORD_LIKE.has(b) && words.some((w) => w.includes(b)));
  if (inside) {
    const proof = ODD_TLDS.has(tld) || words.some((w) => PHISHING_WORDS.some((p) => w.includes(p)));
    return {
      status: proof ? "lookalike" : "risky",
      reason: `It uses the name “${inside.toUpperCase()}” but is not their official site.`,
    };
  }
  if (near) return { status: "risky", reason: `It looks like ${near.site} but is spelled differently.` };
```

3. Replace `nearOfficial`:

```ts
/**
 * A first label close to an official one. Up to two edits of a long name
 * ("hdfcbnak") copies the bank. One edit of a short name can be another word
 * ("kodak" is not kotak), so that is only a warning sign.
 */
function nearOfficial(label: string): { site: string; close: boolean } | null {
  if (label.length < 5) return null;
  let weak: string | null = null;
  for (const o of OFFICIAL) {
    const first = o.split(".")[0];
    if (first.length < 5 || first === label) continue;
    const d = editDistance(first, label);
    if (first.length >= 8 && d <= 2) return { site: o, close: true };
    if (d <= 1) weak ??= o;
  }
  return weak ? { site: weak, close: false } : null;
}
```

The existing link tests (`hdfc-kyc-verify.in` → lookalike, `hdfcbnak.com` → lookalike, and the rest) must pass unchanged.

### T3c. A phone number is not an amount

**Bug.** `AMOUNT_RE` (`src/lib/check/rules.ts:137`) has no word boundary before `rs`, so it reads the end of "officers", "hours", "hrs" or "yours" as rupees. "…Transfer the money now. Our officers 9876543210 will guide you." creates a hold for Rs 9,87,65,43,210.

**Change.** Add a lookbehind at the start of `AMOUNT_RE`:

```ts
const AMOUNT_RE = /(?<![\p{L}\p{N}])(?:rs\.?|₹|inr|rupees?)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(lakh|lakhs|crore))?|(\d[\d,]*(?:\.\d+)?)\s?(lakh|lakhs|crore)?\s?(?:rupees|रुपये|రూపాయలు)/giu;
```

With no amount found, a pasted scam still alerts the family; it just has no amount to hold.

### T3 tests

In `src/lib/check/rules.test.ts`, add before the test "flags requests for OTPs, PINs and screen-sharing apps":

```ts
  it("does not treat a bank's 'we never ask you to share' line as a code request", () => {
    for (const text of [
      "123456 is your OTP for login. SBI never asks you to share your OTP with anyone.",
      "Bank officials will never ask you to share the OTP.",
      "Do not ever share your OTP. HDFC Bank",
      "Don’t share your OTP with anyone.",
      "No one from the bank will ask you to share your PIN.",
      "SBI will never ask you to install AnyDesk.",
    ]) {
      expect(runRules(text).credential, text).toEqual([]);
    }
  });

  it("still flags a code request after an unrelated 'don't'", () => {
    for (const text of [
      "Don't panic, share the OTP now.",
      "Do not disconnect. Share the OTP you received.",
      "Don't worry just share the OTP",
      "I will not ask you to pay, just share the OTP.",
    ]) {
      expect(runRules(text).credential, text).toHaveLength(1);
    }
  });
```

Add inside `describe("links")`, after the "classifies links" test:

```ts
  it("does not call ordinary sites fakes", () => {
    expect(status("Live status: https://trainman.in/pnr/4521")).toBe("unknown");
    expect(status("Book at praxis.com")).toBe("unknown");
    expect(status("Photos: https://s3.amazonaws.com/album.zip")).toBe("risky");
    expect(status("Prints at kodak.com")).toBe("risky");
    expect(status("Sale at mantra.com")).toBe("risky");
    expect(status("Log in at hdfcnetbanking-login.com")).toBe("lookalike");
  });
```

Add inside `describe("family, amount and payee")`, after the existing test:

```ts
  it("does not read a phone number after 'officers' or 'hrs' as rupees", () => {
    for (const text of [
      "Sir this is CBI Mumbai. Stay on the call and tell no one. Transfer the money now. Our officers 9876543210 will guide you.",
      "Transfer within 24 hrs 9876543210 is my number",
    ]) {
      expect(findAmount(text, runRules(text).signals.filter((s) => s.type === "payment")), text).toBeNull();
    }
  });
```

In `src/lib/check/eval.test.ts`, add before the 40-message `describe`:

```ts
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
```

**Done when:**

- `pnpm test` is green: 54 tests (the 11 new tests fail on the old code; "still flags a code request" passes on both, as a guard);
- `pnpm eval > /tmp/eval-after.txt && diff /tmp/eval-before.txt /tmp/eval-after.txt` prints nothing: no example or test-set verdict moves;
- the last line still reads `caught 20/20 · missed 0 · false alarms 0`.

**Commit:** `fix(check): stop false alarms on bank OTP warnings and ordinary links; ignore numbers after "rs" inside words`

---

## T4. Data integrity

### T4a. "Delete my history" keeps a payment that is still on hold

**Bug.** `deleteHistory` (`src/lib/server/checks.ts:257`) deletes every check, and the delete cascades to holds, alerts and advice. If Mr Rao deletes his history while a payment is paused, the hold disappears, and Arjun's Block fails with "That payment was not found."

**Change.** Add `notInArray` to the `drizzle-orm` import, then:

```ts
/** P3 "Delete my history". A payment still on hold stays until family decides, so their Block still reaches it. */
export async function deleteHistory(db: Db, owner: User) {
  const open = await db.query.holds.findMany({
    where: and(eq(schema.holds.userId, owner.id), eq(schema.holds.status, "pending")),
  });
  const keep = open.map((h) => h.checkId);
  await db
    .delete(schema.checks)
    .where(keep.length ? and(eq(schema.checks.userId, owner.id), notInArray(schema.checks.id, keep)) : eq(schema.checks.userId, owner.id));
  await logEvent(db, owner.id, owner.name, "history_deleted", `${owner.name} deleted their check history`);
  return { kept: keep.length };
}
```

`src/app/api/me/checks/route.ts` (`DELETE`): change `await deleteHistory(db, user);` to `return deleteHistory(db, user);`.

**Screen** (`src/screens/rao/history.tsx`, `PrivacyScreen`):

- The sheet text "All your checks and their warning phrases are removed. Payment holds go too." becomes "All your checks and their warning phrases are removed. A payment that is still on hold stays until your family decides."
- `deleteHistory()` becomes:

```ts
    const { kept } = await api<{ kept: number }>("/api/me/checks", { method: "DELETE" });
    setConfirm(false);
    await queryClient.invalidateQueries();
    toast({
      title: "History deleted",
      sub: kept ? "A payment on hold stays until your family decides" : "Your checks are gone from this app",
      icon: "trash",
    });
```

### T4b and T4c. One family account, one person; one code, one person

**Bugs.**

- **T4b.** `acceptInvite` (`src/lib/server/people.ts:96`) lets someone who is already linked take another code. If Arjun also takes Dinesh's code:
  - Arjun gets 2 alerts per scam;
  - Papa reads "Arjun, Meera and Arjun were alerted";
  - Papa's helper list shows "Dinesh", who never joined.

  The family screens only support one protected person (`familyState` uses `findFirst`), so a second household breaks too.
- **T4c.** The update (`:106`) doesn't re-check `status = 'waiting'`. Two people sending one code at the same moment both succeed, and the second silently replaces the first.

**Change** `acceptInvite`. Add a shared message above it:

```ts
const CODE_FAILED = "That code did not work. Check each letter. Each code works once and ends in 24 hours.";
```

Use `CODE_FAILED` for the existing "did not work" error. After the "own trusted person" check, replace the unconditional update with:

```ts
  // One family account looks after one person (the family screens show one), and only once.
  const current = await db.query.links.findFirst({
    where: and(eq(schema.links.familyId, member.id), eq(schema.links.status, "linked")),
  });
  if (current) {
    const linkedTo = await db.query.users.findFirst({ where: eq(schema.users.id, current.protectedId) });
    throw new HttpError(409, `You are already linked to ${linkedTo?.name ?? "someone"}. Unlink in Settings first.`);
  }
  // Only a waiting code can be taken, so two people sending it at once cannot both join.
  const [taken] = await db
    .update(schema.links)
    .set({ familyId: member.id, status: "linked", linkedAt: new Date() })
    .where(and(eq(schema.links.id, link.id), eq(schema.links.status, "waiting")))
    .returning();
  if (!taken) throw new HttpError(400, CODE_FAILED);
```

The rest (the user role and name update, and `logEvent`) stays.

**Screen** (`JoinScreen` in `src/screens/family/screens.tsx`). It always says "That code did not work", which is wrong for "already linked". Add after `const who = ...`:

```ts
  const codeFailed = error?.startsWith("That code did not work") ?? true;
```

In the error block, use `{codeFailed ? "That code did not work" : "We could not link you"}` for the heading line and `{codeFailed ? "Check each letter. Each code works once and ends in 24 hours." : error}` for the line under it.

### T4 tests

In `src/lib/server/flow.test.ts`, add `deleteHistory` to the checks import:

```ts
import { askFamily, createCheck, deleteHistory, getCheckView, openPayment, setFamilyVerdict } from "./checks";
```

Append at the end of the file:

```ts
describe("history and invites", () => {
  it("deleting history keeps a payment that is still on hold", async () => {
    await resetDemo(db);
    const { rao, arjun } = await users();
    const safe = await createCheck(db, rao, { text: text("bank"), source: "paste" });
    const { holdId } = await createCheck(db, rao, { text: text("cbi"), source: "paste" });
    expect(await deleteHistory(db, rao)).toEqual({ kept: 1 });
    expect(await db.query.checks.findFirst({ where: eq(schema.checks.id, safe.checkId) })).toBeUndefined();
    expect((await decideHold(db, arjun, holdId!, "block", false)).status).toBe("blocked");
  });

  it("a linked family member cannot take a second code", async () => {
    await resetDemo(db);
    const { arjun } = await users();
    await expect(acceptInvite(db, arjun, "PB-7H3D")).rejects.toThrow("already linked to Mr Rao");
  });

  it("two people sending one code at once: only one joins", async () => {
    await resetDemo(db);
    const [asha] = await db.insert(schema.users).values({ name: "Asha", phone: "+91 98400 22233" }).returning();
    const [bala] = await db.insert(schema.users).values({ name: "Bala", phone: "+91 98400 33344" }).returning();
    const results = await Promise.allSettled([acceptInvite(db, asha, "PB-7H3D"), acceptInvite(db, bala, "PB-7H3D")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const winner = results[0].status === "fulfilled" ? asha : bala;
    const link = await db.query.links.findFirst({ where: eq(schema.links.inviteCode, "PB-7H3D") });
    expect(link?.familyId).toBe(winner.id);
  });
});
```

**Done when:**

- `pnpm test` is green: 57 tests (the 3 new tests fail on the old code);
- the existing "a waiting code links a new family member once" test still passes;
- lint and the type check pass.

**Commit:** `fix(data): keep live holds on history delete; one code and one link per family member`

---

## T5. A scam with no amount stays on Arjun's home

**Bug.** A pasted SCAM with no amount creates an urgent alert but no hold. The "Bank KYC link" sample on the home screen is one. `FamilyHomeScreen` hides every urgent alert (`src/screens/family/screens.tsx:151`) and shows a hold card only when a hold exists. So once Arjun has opened the alert, his home says "Papa is protected. No payments are paused." and nothing is left to act on. The detail screen also calls it "Heads-up" and labels the button "Mark as handled".

**Change** `src/screens/family/screens.tsx`.

`FamilyHomeScreen`: rename `openAsks` to `openItems` and include urgent alerts without a hold:

```ts
  // Questions, heads-ups, and scam alerts with no payment to block (e.g. a fake KYC link).
  const openItems = data.alerts.filter((a) => a.kind !== "urgent" || !a.holdId);
```

Use `openItems` in the `.map` and in `{!hold && !openItems.length && (`. In the card, use a red tint and its own heading for urgent alerts:

```tsx
        <button key={a.id} className={`card ${a.kind === "urgent" ? "tint-red" : "tint-amber"}`} onClick={() => router.push(`/family/check/${a.checkId}?alert=${a.id}`)}>
          <div className="row">
            <Icon name="bell" />
            <b className="grow" style={{ fontSize: 17 }}>
              {a.kind === "ask"
                ? `${callName} is asking you about a message`
                : a.kind === "urgent"
                  ? `${callName} got a scam message`
                  : `Heads-up: ${callName} got a ${a.verdict.toLowerCase()} message`}
            </b>
```

`FamilyCheckScreen`:

```ts
  const urgent = !fromAsk && !!fam?.alerts.some((a) => a.checkId === id && a.kind === "urgent");
```

- Title and red button label:

```tsx
      <TitleRow title={fromAsk ? `${callName} is asking` : urgent ? "Scam alert" : "Heads-up"} back="/family" right={<VerdictPill verdict={c.verdict} size="medium" icon={false} />} />
```

```tsx
            {fromAsk || urgent ? "It's a scam" : "Mark as handled"}
```

**Test.** Append to `e2e/two-phones.spec.ts`:

```ts
test("scam with no amount: Arjun's home keeps the alert until he answers", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");

  await rao.getByRole("button", { name: "Bank KYC link" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "STOP" })).toBeVisible();

  await expect(arjun.getByRole("heading", { name: "Papa got a scam message" })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open" }).click();
  await expect(arjun.getByRole("heading", { name: "Scam alert" })).toBeVisible();

  // He goes back without answering: his home must still show it.
  await arjun.goto("/family");
  await expect(arjun.getByText("Papa got a scam message")).toBeVisible();
  await expect(arjun.getByText("Papa is protected")).toHaveCount(0);
});
```

**Done when:** lint and the type check pass, and `pnpm build && pnpm e2e` passes 4 tests (the new one fails on the old build).

**Commit:** `fix(family): keep scam alerts without a payment on Arjun's home`

---

## T6. Spec rules

### T6a. No percentages on "Why we think so"

**Bug.** `WhyScreen` (`src/screens/rao/evidence.tsx:150-153`) prints "Spam score 95% · warning signs 80% · pattern model 98%". The spec says the app never shows a percentage.

**Change.** Replace that whole `<p className="sm">Spam score …</p>` block with:

```tsx
      {c.decidedBy === "ai" && <p className="sm">Confirmed by AI.</p>}
```

The operator page `/tests` may keep its numbers.

### T6b. Trusted people need a real, new mobile number

**Bug (the B2 spec).**

- Any 10 or more characters pass as a phone number.
- The same number can be added twice.
- Mr Rao can add his own number.
- Numbers are stored as typed, so they don't match the "+91 98765 43210" format that sign-in uses.

**Change.** Create `src/lib/phone.ts`:

```ts
/**
 * "+91 98765 43210" from what people type (spaces, dashes, +91, 0091 or a
 * leading 0), the same format sign-in uses. Null if it is not an Indian mobile number.
 */
export function toIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^(?:0091|091|91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
```

Replace `src/lib/server/schemas.ts` with:

```ts
import { z } from "zod";
import { toIndianMobile } from "@/lib/phone";

export const personBody = z.object({
  name: z.string().trim().min(1, "Please type a name.").max(40),
  relation: z.enum(["Son", "Daughter", "Spouse", "Friend"]),
  phone: z
    .string()
    .trim()
    .refine((v) => toIndianMobile(v) !== null, "Please type a 10-digit mobile number.")
    .transform((v) => toIndianMobile(v)!),
  earlyHeadsUp: z.boolean().default(true),
});
```

In `src/lib/server/people.ts`, add above `addPerson`:

```ts
/** B2: the same number twice, or Mr Rao's own number, would send alerts to the wrong phone. */
async function assertNewNumber(db: Db, owner: User, phone: string, exceptId?: string) {
  if (phone === owner.phone) throw new HttpError(400, "That is your own number. Add someone you trust.");
  const same = await db.query.links.findFirst({
    where: and(eq(schema.links.protectedId, owner.id), eq(schema.links.phone, phone)),
  });
  if (same && same.id !== exceptId) throw new HttpError(409, `${same.name} already has this number.`);
}
```

Then call `await assertNewNumber(db, owner, input.phone);` as the first line of `addPerson`, and `await assertNewNumber(db, owner, input.phone, id);` as the first line of `updatePerson`. Leave sign-in as it is: the README promises it takes any 10-digit number. `PersonFormScreen` already shows server errors.

### T6c. Warn before removing the last linked person

**Bug (the B5 spec).** Removing the only linked person gives no warning that nobody will be told.

**Change** `RemoveSheet` in `src/screens/rao/people.tsx`. It renders inside Mr Rao's shell, so `useRao()` is available.

```tsx
function RemoveSheet({ p, onCancel, onConfirm }: { p: PersonView; onCancel: () => void; onConfirm: () => void }) {
  const { data } = useRao();
  const lastLinked = p.status === "linked" && !data?.people.some((x) => x.id !== p.id && x.status === "linked");
  return (
    <Sheet onClose={onCancel}>
      <h2 className="h2">Remove {p.name}?</h2>
      <p className="p">They will stop getting your scam alerts. Your checked messages stay private.</p>
      {lastLinked && (
        <div className="card tint-red">
          <b style={{ fontSize: 17 }}>Nobody will be told</b>
          <p className="sm" style={{ color: "var(--text)" }}>{p.name} is the only person who gets your scam alerts. Add someone else soon.</p>
        </div>
      )}
      {/* the two existing buttons stay unchanged */}
```

### T6 tests

In `src/lib/server/flow.test.ts`, change the people import to `import { acceptInvite, addPerson } from "./people";`, and add `import { personBody } from "./schemas";`. Append this block (T7 adds two more tests to it):

```ts
describe("people, codes and days", () => {
  it("trusted people need a real mobile number, once, and not his own", async () => {
    await resetDemo(db);
    const { rao } = await users();
    expect(personBody.safeParse({ name: "Ravi", relation: "Friend", phone: "12345" }).success).toBe(false);
    expect(personBody.parse({ name: "Ravi", relation: "Friend", phone: "098400-55566" }).phone).toBe("+91 98400 55566");
    const arjunAgain = { name: "Arjun 2", relation: "Son", phone: "+91 91234 56789", earlyHeadsUp: true };
    await expect(addPerson(db, rao, arjunAgain)).rejects.toThrow("Arjun already has this number");
    await expect(addPerson(db, rao, { ...arjunAgain, phone: rao.phone })).rejects.toThrow("your own number");
  });
});
```

Append to `e2e/two-phones.spec.ts`:

```ts
test("the evidence screen shows no percentages", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await rao.getByRole("button", { name: "Why we think so" }).click();
  await expect(rao.getByRole("heading", { name: "Why we think so" })).toBeVisible();
  await expect(rao.getByText(/\d\s?%/)).toHaveCount(0);
});

test("removing the last linked person warns that nobody will be told", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.goto("/setup");
  await rao.getByRole("button", { name: "Remove Meera" }).click();
  await expect(rao.getByText("Nobody will be told")).toHaveCount(0);
  await rao.getByRole("button", { name: "Yes, remove Meera" }).click();
  await rao.getByRole("button", { name: "Remove Arjun" }).click();
  await expect(rao.getByText("Nobody will be told")).toBeVisible();
});
```

The `beforeEach` reset relinks Meera for the next test.

**Done when:** `pnpm test` is green (58 tests), and `pnpm build && pnpm e2e` passes 6 tests.

**Commit:** `fix(ui): no percentages for Mr Rao; check trusted-person numbers; warn before removing the last helper`

---

## T7. Before a public deploy

### T7a. Operator key for /demo, test runs and "Reset demo data"

**Bug.** Five routes need no sign-in:

- `/api/demo/reset`
- `/api/demo/personas`
- `/api/demo/sample`
- `/api/demo/events`
- `/api/tests/run`

`/api/tests/run` with `mode: "sonnet"` makes up to 40 paid Claude calls per request, so anyone with the URL can spend the API budget.

**Design.** If the `OPERATOR_KEY` environment variable is unset (a laptop or CI), nothing changes. If it is set, those five routes need the key in an `x-operator-key` header. The operator pages ask for it once per browser tab. `/api/tests/latest` stays open; it only reads.

Create `src/lib/server/operator.ts`:

```ts
import crypto from "node:crypto";
import { HttpError } from "./session";

/**
 * The operator tools (/demo, /tests runs, "Reset demo data") are open on a
 * laptop. Before a public deploy set OPERATOR_KEY: these routes then need it
 * in the x-operator-key header.
 */
export function requireOperator(req: Request) {
  const key = process.env.OPERATOR_KEY;
  if (!key) return;
  const given = Buffer.from(req.headers.get("x-operator-key") ?? "");
  const expected = Buffer.from(key);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(401, "This needs the operator key.");
  }
}
```

In each of the 5 route files:

1. Add `import { requireOperator } from "@/lib/server/operator";`.
2. Make the handler take `req` (`route(async (req) => {`).
3. Make `requireOperator(req);` its first line.

In `src/lib/client/api.ts`, let `api()` take extra headers:

```ts
export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
```

```ts
      headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
```

Then append:

```ts
const OPERATOR_KEY = "pb-operator-key";

/**
 * Calls an operator route (/demo, /tests runs, reset). Sends the key saved in
 * this tab. If the server asks for one (401) and `ask` is on, it asks once and retries.
 */
export async function operatorApi<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, ask = true): Promise<T> {
  const withKey = (key: string | null) => api<T>(path, { ...init, headers: key ? { "x-operator-key": key } : undefined });
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(OPERATOR_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    return await withKey(saved);
  } catch (error) {
    if (!ask || !(error instanceof ApiError) || error.status !== 401) throw error;
    const key = window.prompt("Operator key")?.trim();
    if (!key) throw error;
    try {
      sessionStorage.setItem(OPERATOR_KEY, key);
    } catch {
      /* storage blocked */
    }
    return withKey(key);
  }
}
```

Use `operatorApi` for every operator call:

- `src/screens/operator.tsx`. Import line: `import { api, broadcastWifiDrop, operatorApi } from "@/lib/client/api";` (`post` is no longer used there).
  - `/tests` run: `mutationFn: (mode: "rules" | "haiku" | "sonnet") => operatorApi("/api/tests/run", { body: { mode } }),`
  - `/demo` sign-in on mount:

    ```ts
        void operatorApi("/api/demo/personas", { body: {} })
          .then(() => setReady(true))
          .catch(() => {});
    ```

  - Events polling, which must not prompt every 2 seconds:

    ```ts
            const r = await operatorApi<{ events: EventView[] }>(`/api/demo/events?since=${since.current}`, {}, false);
    ```

  - `reset()`: `await operatorApi("/api/demo/reset", { body: {} });`
  - `sample()`: `await operatorApi("/api/demo/sample", { body: {} });`
- `src/screens/family/screens.tsx` (`FamilySettingsScreen.reset`): `await operatorApi("/api/demo/reset", { body: {} });`, and add `operatorApi` to the import from `@/lib/client/api`.

The browser tests' `beforeEach` posts `/api/demo/reset` without a key. That keeps working because CI doesn't set `OPERATOR_KEY`.

### T7b. No built-in secrets on a deployment

**Bug.** Without `SESSION_SECRET` or `FINGERPRINT_SECRET`, the app silently uses secrets written in the source (`src/lib/server/session.ts:15`, `src/lib/server/checks.ts:46`). Anyone could then forge a sign-in cookie on a deployment that forgot them.

**Change.** Create `src/lib/server/secrets.ts`:

```ts
/** A secret from the environment. Deployments must set it; a laptop uses a fixed dev value. */
export function secretFromEnv(name: "SESSION_SECRET" | "FINGERPRINT_SECRET", devValue: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.VERCEL) throw new Error(`Set ${name} for deployments (see .env.example).`);
  return devValue;
}
```

- `src/lib/server/session.ts`: `const secret = () => secretFromEnv("SESSION_SECRET", "pause-button-dev-secret");` (import from `./secrets`).
- `src/lib/server/checks.ts` (`fingerprint`): `const key = secretFromEnv("FINGERPRINT_SECRET", "pause-button-dev-fingerprint");` (import from `./secrets`).

Use `VERCEL`, not `NODE_ENV`, to detect a deployment. CI and `pnpm start` run with `NODE_ENV=production` and no secrets, and must keep working. This matches the existing `DATABASE_URL` check in `src/lib/db/index.ts`.

### T7c. Six-character invite codes

**Bug.** Codes have 4 characters (`src/lib/server/people.ts:16`), about 1 million combinations, last 24 hours, and have no attempt limit. A script could guess one through `/api/family/invite`. This matters once sign-in is real.

**Change** `newInviteCode`. Use `crypto.randomBytes(6)` and add the comment `// Six characters: about a billion codes, too many to guess. The demo codes stay short.` The fixed demo codes (`PB-4K7Q`, `PB-9M2X`, `PB-7H3D`) stay as they are, and the join screen already accepts longer codes.

### T7d. "Today" means today in India

**Bug.** Arjun's "checked today" counter uses `setHours(0, 0, 0, 0)` in the server's time zone (`src/lib/server/state.ts:109`). On Vercel (UTC), the day starts at 05:30 in India.

**Change.** `src/lib/check/config.ts`, after `INVITE_HOURS`:

```ts
// "Today" on the family home starts at midnight in India (IST is UTC+5:30, no daylight saving).
export const APP_UTC_OFFSET_MINUTES = 330;
```

`src/lib/server/state.ts`: import `APP_UTC_OFFSET_MINUTES` from `@/lib/check/config`, and add above `raoState`:

```ts
/** Midnight today in India, whatever time zone the server runs in (Vercel runs in UTC). */
export function startOfToday(now = Date.now()) {
  const offset = APP_UTC_OFFSET_MINUTES * 60_000;
  const local = now + offset;
  return new Date(local - (local % 86_400_000) - offset);
}
```

In `familyState`, delete the two `todayStart` lines and use `gte(schema.checks.createdAt, startOfToday())`.

### T7 docs

- `.env.example`, after `FINGERPRINT_SECRET=`:

  ```bash

  # Before a public deploy: /demo, the /tests runs and "Reset demo data" then
  # ask for this key once per browser tab. Leave empty on a laptop.
  OPERATOR_KEY=
  ```

- `README.md`:
  - In "CI/CD → Environment variables", add `OPERATOR_KEY` (needed for any public URL).
  - Replace the "Operator pages are open." bullet with: "**Operator pages need a key on a public URL.** Set `OPERATOR_KEY`: `/demo`, the `/tests` runs and "Reset demo data" then ask for it once per browser tab. Without it (on a laptop) they stay open."
  - Under Holds, add:
    - "After 10 minutes only Block works; an expired hold is never approved."
    - "The first family answer to a question wins, and Mr Rao sees the first advice."
  - In "How a message is checked", step 4: "If it is missing or slow" becomes "If it is missing, slow, cut off or refuses".
  - In the Tests section: "35 tests" becomes "64 tests".

### T7 tests

Create `src/lib/server/deploy.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { requireOperator } from "./operator";
import { secretFromEnv } from "./secrets";

// Settings that must be in place before a public deploy.

const saved = { OPERATOR_KEY: process.env.OPERATOR_KEY, VERCEL: process.env.VERCEL, SESSION_SECRET: process.env.SESSION_SECRET };
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const call = (key?: string) => new Request("http://localhost/api/demo/reset", { method: "POST", headers: key ? { "x-operator-key": key } : {} });

describe("operator key", () => {
  it("is not needed while OPERATOR_KEY is unset (laptop demo, CI)", () => {
    delete process.env.OPERATOR_KEY;
    expect(() => requireOperator(call())).not.toThrow();
  });

  it("is needed once OPERATOR_KEY is set", () => {
    process.env.OPERATOR_KEY = "s3cret";
    expect(() => requireOperator(call())).toThrow("operator key");
    expect(() => requireOperator(call("wrong"))).toThrow("operator key");
    expect(() => requireOperator(call("s3cret"))).not.toThrow();
  });
});

describe("secrets", () => {
  it("uses the dev value on a laptop", () => {
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    expect(secretFromEnv("SESSION_SECRET", "dev")).toBe("dev");
  });

  it("refuses to run a deployment without one", () => {
    process.env.VERCEL = "1";
    delete process.env.SESSION_SECRET;
    expect(() => secretFromEnv("SESSION_SECRET", "dev")).toThrow("Set SESSION_SECRET");
    process.env.SESSION_SECRET = "long-random-value";
    expect(secretFromEnv("SESSION_SECRET", "dev")).toBe("long-random-value");
  });
});
```

In `src/lib/server/flow.test.ts`, change two imports to `import { acceptInvite, addPerson, newInviteCode } from "./people";` and `import { familyState, raoState, startOfToday } from "./state";`. Then add these two tests inside `describe("people, codes and days")` (from T6):

```ts
  it("new invite codes are six characters", () => {
    expect(newInviteCode()).toMatch(/^PB-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("today starts at midnight in India, whatever the server's time zone", () => {
    expect(startOfToday(Date.parse("2026-10-09T20:00:00Z")).toISOString()).toBe("2026-10-09T18:30:00.000Z"); // 01:30 IST on the 10th
    expect(startOfToday(Date.parse("2026-10-09T10:00:00Z")).toISOString()).toBe("2026-10-08T18:30:00.000Z"); // 15:30 IST on the 9th
  });
```

**Done when:**

- `pnpm test` passes 64 tests in 7 files;
- lint and the type check pass;
- `pnpm build && pnpm e2e` passes 6 tests;
- locally, `OPERATOR_KEY=test pnpm dev` makes `/demo` ask for the key once, then works.

**Commit:** `feat(ops): operator key, required secrets on deploys, longer invite codes, India-time "today"`

---

## 4. Final verification (run all of it)

```bash
pnpm lint
pnpm next typegen && pnpm typecheck
pnpm test                         # 7 files, 64 tests
pnpm build
pnpm e2e                          # 6 tests
pnpm eval > /tmp/eval-after.txt; diff /tmp/eval-before.txt /tmp/eval-after.txt   # no output
git diff --stat main...HEAD       # about 34 files: the 32 code and test files above, README.md and .env.example (plus this plan file if your branch has it)
```

Then run the README's 2-minute demo script by hand (`pnpm dev`, the `/demo` panel):

- scam → STOP → Arjun blocks → "Payment cancelled";
- courier → Ask Arjun → "not a scam";
- the scam sample in the simulated inbox.

All three must behave as before.

Re-read your own diff and check:

- no unrelated edits;
- no `console.log` left in;
- no test weakened;
- every new screen string is short and plain.

## 5. Behaviour changes to tell the team

- A second family answer is refused ("Arjun already answered: it is a scam."). Mr Rao sees the first advice.
- After the 10 minutes, the family can only Block; Approve is gone from the expired screen.
- "Pay anyway (demo)" shows only when no hold exists yet, or after Mr Rao cancelled his own. For pasted scams with an amount it never shows. A blocked payment can't be reopened.
- "Delete my history" keeps a payment that is still on hold until family decides.
- A family account links to one person only, once.
- Bank OTP texts with "never share" lines are no longer called SCAM. A brand inside a longer web address (`s3.amazonaws.com`), or one letter off a short brand (`kodak.com`), now adds warning points instead of forcing SCAM. The 40-message results are unchanged.
- Trusted people's numbers must be Indian mobile numbers. They are stored as "+91 98765 43210", and duplicates or his own number are refused.
- New invite codes have 6 characters (the demo codes are unchanged).
- On Vercel, set `SESSION_SECRET`, `FINGERPRINT_SECRET` and `OPERATOR_KEY`, or the app refuses requests that need them.

## 6. Out of scope (needs a team decision first)

These differ from the spec but are product choices, not bugs. Don't change them in this work.

1. Score bands: the spec says SCAM at 60 and above; the code uses 70 and above, and also needs a phrase match (`config.ts`).
2. Claude reads only SUSPICIOUS messages (the spec says every message, and the AI can only raise the verdict). The AI timeout is 2.5 s (the spec says 6 s).
3. The spec's fixed SCAM rules "OTP + urgency" and "threat + payment" aren't hard rules. Any OTP request is a hard rule, and threat + payment reaches SCAM through the model.
4. A SCAM with no amount starts no 10-minute cool-off (the spec says it always does). T5 keeps it visible to the family; whether to show a countdown is a product call.
5. "Ask Arjun" on SUSPICIOUS sends a question and starts no hold (an open question in the spec).
6. API paths differ from the research doc (`/api/me/*`, `/api/family/*`). Rename them only as part of the mobile SDK work.
7. H4 copy: the spec has the Pay button coming back with "Continue to pay" and "Cancel"; the app says "released" with "Done".
8. Installable app: there is a manifest but no service worker. Hindi and Telugu screens (K3) and the Sprint 2 observer are still to come.
9. Family accounts linked to several people (T4b refuses this for now), and rate-limiting invite-code attempts (T7c makes guessing impractical).
