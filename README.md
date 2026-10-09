# Pause Button: phase 1 simulator

A calm second opinion before the money moves. An older person (Mr Rao) checks a worrying message. If it is a scam, the app stops him, pauses the payment and alerts his family (Arjun, Meera). Arjun then blocks or approves the payment from his own phone.

Phase 1 is a **simulator**: a web app that runs on any phone or laptop. It has no real SMS, no real money and no real calls; every message is made up. The screens follow the design file (screens A–L, P, Q and parts of N/O).

## Run it

```bash
pnpm install
pnpm dev                 # http://localhost:3000
```

Nothing else is needed. Without `DATABASE_URL` the app runs an embedded Postgres (PGlite) in `.data/` and creates the demo household on first start. Copy `.env.example` to `.env.local` to add a Claude key (optional).

| URL | What it is |
|---|---|
| `/` | Mr Rao's phone (redirects to `/welcome` until signed in) |
| `/family` | Arjun's phone |
| `/demo` | Operator panel: both phones side by side, live event log, reset, scam sample, Wi-Fi drop |
| `/tests` | Operator page: the 40-message test set, with misses listed verbatim |

**Sign-in is mock.** Use "Continue as Mr Rao (demo)" / "Continue as Arjun (demo)", or any 10-digit number with code `1234`. A new number goes through "Who is this phone for?" and the setup and invite screens. The demo invite codes are `PB-4K7Q` (Arjun, linked), `PB-9M2X` (Meera, linked) and `PB-7H3D` (Dinesh, waiting).

**Two real phones:** run `pnpm dev`, then open the "Network" URL that Next prints (same Wi-Fi) on both phones. Sign one in as Mr Rao and the other as Arjun. Tap Arjun's screen once so it is allowed to play sound.

### Demo script (about 2 minutes)

1. Open `/demo` and press **Reset demo data**.
2. On Mr Rao's phone, tap **CBI parcel call** → **Check this message**. He sees **STOP**, then the SCAM verdict. Rs 80,000 is paused for 10 minutes.
3. Arjun's phone buzzes, flashes and sounds (I1). **Open** → choose advice → **Block this payment**.
4. Mr Rao's phone jumps to **Payment cancelled**, with Arjun's advice.
5. **Courier fee** gives SUSPICIOUS → **Ask Arjun** → Arjun answers **This is not a scam** → Mr Rao sees "You can carry on".
6. **Run a scam sample** (or "Receive a test scam message" in the simulated inbox). The message arrives by WhatsApp, a banner appears, and Arjun gets a quiet heads-up.

## How a message is checked

`src/lib/check/pipeline.ts`:

1. **Normalise** (`normalize.ts`): undo `acc0unt`-style digits, look-alike letters, `K.Y.C` spacing and zero-width characters. It keeps a map back to the original text so phrases can be highlighted.
2. **Hard rules → SCAM straight away.** `rules.ts` and `links.ts`:
   - secrecy **and** payment together (the design's "floor");
   - a request for an OTP, PIN or CVV, or for a screen-sharing app;
   - a link that copies a bank or brand (`sbi-kyc-update.com`), or a site on the blocklist.
3. **Soft rules → spam percentage.**
   - Signal points: Secrecy 25, Payment 25, Authority 15, Fear 15, plus a risky link (20) or an unknown link (10).
   - The fast-gate model (TF-IDF + logistic regression, `gate.ts`, under 1 ms) gives a probability.
   - Spam % = the higher of the two. **70% or more with at least one phrase = SCAM. 30–69% = SUSPICIOUS (ask family). Below 30% = SAFE.**
4. **Claude, only for SUSPICIOUS.** If `ANTHROPIC_API_KEY` is set, `claude-haiku-5-5` reads the message:
   - it uses structured output and has a 2.5 s timeout with no retries;
   - its phrases must appear word for word in the message;
   - it can **raise** the verdict, never lower it.
   - If it is missing or slow, the screen shows "Checked by rules only — AI unavailable".

Thresholds and points live in `src/lib/check/config.ts`. Tune them on `/tests`. All wording people see comes from templates in `copy.ts`, never from the AI.

What happens after the verdict (`src/lib/server/checks.ts`):

| | Pasted message | Message arriving in the simulated inbox |
|---|---|---|
| SCAM | STOP screen. Urgent alert to every linked person. A 10-minute **hold** if the message names an amount. | Banner. A quiet **heads-up** to family (if "Tell Arjun automatically" is on). The hold starts if he taps "Pay anyway". |
| SUSPICIOUS | "Ask Arjun" sends a question. Arjun answers "scam" or "not a scam". | Same, from the banner's "Tell Arjun". |
| SAFE | Done ("Ask Arjun anyway" is still there). | Shown as SAFE in the inbox. |

Holds:
- The first decision wins: Block, or Approve (which needs a second confirm).
- After 10 minutes a hold reads as **expired** but the money stays held, and Block still works.
- Expiry is derived from `expires_at`, so no background job is needed.

**Privacy:** the server stores a keyed fingerprint, the verdict and the warning phrases, never the message text. Pasted text stays in the phone's `sessionStorage`, so "Why we think so" can highlight it. The simulated inbox stores text because it stands in for the phone's own SMS app, and it only holds made-up messages.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript. CSS ported from the design system (`src/app/globals.css`). Installable as a PWA (manifest). |
| Polling | TanStack Query, every 2 s (`/api/me/state`, `/api/family/state`), as in the design |
| API | Next.js Route Handlers (`src/app/api/**`). Logic in `src/lib/server/*`. Zod validation. |
| Database | PostgreSQL through Drizzle ORM. PGlite (embedded) locally and in tests; Neon in production. Migrations in `drizzle/`. |
| Model | `ml/`: Python trains, JSON is exported, TypeScript scores. See `ml/README.md` for data, licences and retraining. |
| AI | Anthropic TypeScript SDK, `claude-haiku-5-5` (live) and `claude-sonnet-5-5` (`/tests` "final" run) |
| Tests | Vitest (rules, pipeline, model parity, server flow, 40-message quality gate). Playwright two-phone end-to-end. |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) and Vercel (`vercel.json`) |

## Project layout

```
src/app/(auth)/        welcome, sign-in, role (A0–A2)
src/app/(rao)/         Mr Rao's phone: home, check/[id]/…, hold/[id], history, settings, setup, inbox
src/app/family/        Arjun's phone: home, join, alerts-setup, alert/[id], hold/[id], check/[id], activity, settings
src/app/tests, demo    operator pages (L1, L2)
src/app/api/           route handlers (37)
src/screens/           the screens, one file per area
src/lib/check/         normalise, rules, links, fast gate, Claude reader, pipeline, wording
src/lib/server/        sessions, checks, holds, people/invites, simulated inbox, state, demo reset, test runs
src/lib/db/            Drizzle schema and client
src/data/              examples, 40-message test set, simulated inbox messages, blocklist, gate model
ml/                    fast-gate training (Python) and seeds
e2e/                   two-phone Playwright test
```

## Tests

```bash
pnpm test        # 35 tests: rules, pipeline, model parity, server flow, quality gate
pnpm eval        # prints every example and test message with its verdict and scores
pnpm build && pnpm e2e   # two browser "phones" against a fresh in-memory database
```

Current results with rules and the model only (no AI): **20/20 scams caught, 0 false alarms**. 2 genuine messages land in SUSPICIOUS (a bank debit alert and a police advisory). 38 of 40 are answered without needing Claude.

## CI/CD

- **Every PR:** lint → type check → `pnpm test` (including the quality gate) → build → Playwright two-phone e2e.
- **On `main`, or a PR labelled `ai-eval`:** `pnpm eval --ai haiku`, run when the `ANTHROPIC_API_KEY` secret is set.
- **Deploy:** connect the repo to Vercel. Each PR gets a preview URL, and `main` deploys to production. `vercel.json` runs `pnpm db:migrate && pnpm build` in the Singapore region.
- **Environment variables** for every Vercel environment:
  - `DATABASE_URL` (Neon, same region; the Neon–Vercel integration can create a branch per preview);
  - `SESSION_SECRET`, `FINGERPRINT_SECRET`;
  - optionally `ANTHROPIC_API_KEY`.

## Deliberate choices and limits in phase 1

- **"Call Arjun" / "Call 1930" never dial.** They show a "Calling … (demo)" toast, so nobody rings the real cyber helpline by accident during a demo.
- **Phase 2 or later:**
  - the Android notification reader (screens M1–M4);
  - lock-screen notifications (N2), Web Push, quiet hours and escalation calls (O3), and the weekly summary (O4);
  - Hindi and Telugu screens (K3). The language chips say "Phase 2". The checker already reads Hindi, Telugu and Hinglish.
- **Operator pages are open.** `/demo`, `/tests` and "Reset demo data" have no login. Put them behind a password before a public deploy.
- **The rules are a starting point.** The test set is small and team-written, and the training data is synthetic. Treat the numbers as a sanity check, not real-world accuracy.
- **Claude refusals and timeouts fall back to rules only.** No refusal fallback model is configured.
