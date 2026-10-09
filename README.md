# Pause Button: simulator and Android app

A calm second opinion before the money moves. An older person (Mr Rao) checks a worrying message. If it is a scam, the app stops him, pauses the payment and alerts his family (Arjun, Meera). Arjun then blocks or approves the payment from his own phone.

The **simulator** is a web app that runs on any phone or laptop. It has no real SMS, no real money and no real calls; every message is made up. The screens follow the design file: phase 1 (screens A–L, P, Q and parts of N/O), the Android watcher (M), and the phase 2 feature proposals F1–F14 (see "Phase 2" below).

## Run it

Needs Node 24, pnpm 11 and (only for retraining the model) Python 3.9+.

```bash
pnpm install                              # Node modules
pnpm exec playwright install chromium     # browser for the end-to-end tests (once)
pnpm ml:setup                             # Python ML libraries in ml/.venv (only to retrain; once)
pnpm dev                                  # the simulator: http://localhost:3000/demo
```

Nothing else is needed to run the app. Without `DATABASE_URL` the app runs an embedded Postgres (PGlite) in `.data/` and creates the demo household on first start. Copy `.env.example` to `.env.local` to add a Claude key (optional).

| URL | What it is |
|---|---|
| `/` | Mr Rao's phone (redirects to `/welcome` until signed in) |
| `/family` | Arjun's phone |
| `/demo` | Operator panel: both phones side by side, live event log, reset, scam sample, Wi-Fi drop, lock-screen toggle per family phone |
| `/tests` | Operator page: the 40-message test set, with misses listed verbatim; tabs **Disagreements** (F4) and **Families** (F7) |
| `/campaigns` | Operator page: campaign radar, messages grouped by fingerprint (F3) |
| `/reports` | Operator page: family-reported domains waiting for review (F9) |

**Sign-in is mock.** Use "Continue as Mr Rao / Mrs Rao / Arjun / Meera (demo)", or any 10-digit number with code `1234`. A new number goes through "Who is this phone for?" and the setup and invite screens. The demo household: Mr Rao ("Papa") and Mrs Rao ("Mummy") are both protected by Arjun and Meera, so each family phone shows a **"Who you protect"** list with one card per parent; Mr Rao's friend Dinesh is invited but waiting. Invite codes: Mr Rao's `PB-4K7Q` (Arjun), `PB-9M2X` (Meera), `PB-7H3D` (Dinesh); Mrs Rao's `PB-2M8R` (Arjun), `PB-5T6W` (Meera). A family member links another person from Settings → "Link another person".

**Two real phones:** run `pnpm dev`, then open the "Network" URL that Next prints (same Wi-Fi) on both phones. Sign one in as Mr Rao and the other as Arjun. Tap Arjun's screen once so it is allowed to play sound.

**Calls:** every "Call Arjun", "Call Papa" and "Call cyber helpline 1930" button opens the phone's dialer with the number filled in; the person still taps the green call button. On a laptop (and in `/demo`) it shows the number instead.
- The numbers come from the trusted people Mr Rao added and from the sign-in number.
- The demo personas use placeholder numbers that may belong to strangers. Before a live demo, put your teammates' real numbers in `.env.local` (`DEMO_RAO_PHONE`, `DEMO_MOM_PHONE`, `DEMO_ARJUN_PHONE`, `DEMO_MEERA_PHONE`) and restart `pnpm dev`.
- Family phones call the parents by nickname ("Papa", "Mummy": `users.nickname`, set for the demo personas); friends see the name.

### Demo script (about 2 minutes)

`/demo` shows three phones: the left one switches between **Mr Rao (Papa)** and **Mrs Rao (Mummy)**, then **Arjun** (son) and **Meera** (daughter). Tap Arjun's and Meera's phones once so they may play sound.

1. Press **Reset demo data**.
2. On Mr Rao's phone, tap **CBI parcel call** → **Check this message**. He sees **STOP**, then the SCAM verdict with "47 other families got this today" (F3). Rs 80,000 is above the two-key line (F13), so it is paused for an hour and release needs both Arjun and Meera.
3. Both family phones buzz, flash and sound (I1). On Arjun's phone: **Open**: he reads **the exact message Papa got**, with the warning signs highlighted → write a sentence in his own words (F11) → **Send and call Papa** (opens the dialer) → **Block this payment**.
4. One Block settles it: Mr Rao's phone jumps to **Payment cancelled**, Meera's alert closes, and Arjun's home now shows the ledger: "1 payment paused · Rs 80,000 held" (F12).
5. **Courier fee** gives SUSPICIOUS → **Ask Arjun** → Arjun answers **This is not a scam**. Mr Rao still sees SUSPICIOUS, with "Arjun: not a scam · Waiting for Meera…". When Meera also answers **This is not a scam**, he sees "Arjun and Meera checked it. It is not a scam." If Meera says **It's a scam** instead, it becomes a SCAM.
6. **Run a scam sample** (or "Receive a test scam message" in the simulated inbox). The message arrives by WhatsApp, a banner appears, and both get a quiet heads-up. In the inbox, **Share → Send to Pause Button** forwards it with no copy and no paste (F1).
7. **Lock screen** on Arjun's phone (chip above his frame) after step 2: the notification carries **Block payment**; it works without unlocking (F2).
8. **Someone is calling me** on Mr Rao's home: three questions, then **HANG UP**, and Arjun's phone says "Papa is on a scam call" (F6).
9. Settings → **Language** → हिन्दी, then check **लॉटरी (Hindi)**: every screen and the verdict speak Hindi (F5).

On real phones, sign the third phone in with **Continue as Meera (demo)**.

## Phase 2 (design screens F1–F14)

All fourteen proposals are built in the simulator; the Android app carries the native piece of F1. Every number on the operator pages comes from columns the app already writes; the "other households" in the demo are synthetic sightings (`src/data/campaigns.json`), labelled as such.

| # | Feature | Where it lives |
|---|---|---|
| F1 | **Forward to Pause**: no copy, no paste. "Pause Button" in the phone's Share sheet (Android `ShareActivity`, PWA `share_target`) lands on `/share`, which checks the text and opens the verdict with "FORWARDED FROM WHATSAPP" and "What they asked for". The simulated inbox has the same Share sheet. | `src/screens/rao/share.tsx`, `android/…/ShareActivity.java` |
| F2 | **Lock-screen alerts with Block built in**: the Web Push notification for a paused payment carries **Block payment** and **It's fine**; Block works in the service worker without opening the app and answers "You blocked it". "It's fine" opens the approve step (approving always needs the second confirm). The simulator's `/family/lock` is the same notification on a locked phone. | `public/sw.js`, `src/screens/family/phase2.tsx` |
| F3 | **Campaign radar**: every scam or suspicious check records a sighting (fingerprint + household key, never text). The verdict says "N other families got this today"; `/campaigns` lists campaigns by fingerprint. | `src/lib/server/sightings.ts` |
| F4 | **Disagreement report**: `/tests → Disagreements` groups every check with a family answer by the stage that decided it (hard rule, score band, Claude) and lists the scams a family approved, signals only. | `src/lib/server/ops.ts` |
| F5 | **Hindi and Telugu, for real**: Settings → Language. Every Mr Rao screen and warning reads from one dictionary per language (`src/lib/i18n`); verdict copy comes back from the server in his language; family screens stay English. Native-speaker sign-off is still required before shipping. | `src/lib/i18n/*.ts`, `src/screens/rao/language.tsx` |
| F6 | **Live-call guard**: "Someone is calling me" on the home screen. Three yes/no questions; any yes convicts the call (hard rule `live_call`), the family gets an urgent "Papa is on a scam call" alert, and the answers become a short account the rules highlight. | `src/lib/server/calls.ts`, `src/screens/rao/call.tsx` |
| F7 | **Measure the scam family**: Claude's `scam_type` is now stored (`checks.ai_scam_type`); `/tests → Families` compares our regex family with Claude's name for the trick on the last Claude run. | `src/lib/server/ops.ts` |
| F8 | **Novel-scam escape hatch**: when no rule and no link matched and Claude's quoted words convict it, the check is marked `novel`; the verdict shows **NEW TRICK**, "The words that gave it away" (verified letter by letter) and "None of our usual rules matched". | `src/lib/check/pipeline.ts` |
| F9 | **Family-reported domains**: an alerted member reports the link in two taps; `/reports` is the review queue; **Block** adds the domain to the live blocklist the checker reads on every check (no redeploy). Official sites are refused on sight. | `src/lib/server/reports.ts`, `src/lib/check/links.ts` |
| F10 | **Speak and listen**: "Read it aloud" on every verdict (speech synthesis, in his language); "Speak instead of typing" on the home screen (speech recognition, Chrome). | `src/lib/client/speech.ts`, `src/screens/rao/speak.tsx` |
| F11 | **Advice in his own words**: the chips fill a textarea (200 characters); **Send and block this payment** / **Send and call Papa**. The same box sits under "It's a scam" on the heads-up screen. | `src/screens/family/screens.tsx` |
| F12 | **The household ledger**: "This month: N payments paused · Rs X held" and "What we stopped" on the family home; `/family/month` is the monthly note with the fastest answer and the scams going around, with **Share this with the family**. | `src/lib/server/ledger.ts` |
| F13 | **Two keys for large amounts**: above Rs 50,000 the hold lasts an hour (`TWO_KEY_HOLD_MINUTES`), both phones say "This one needs two of you", and "Who has decided" is always shown. One Block still stops it; release needs everyone. | `src/lib/server/holds.ts` |
| F14 | **States that keep trust**: the payment and hold screens say "We cannot reach the app · The money is still held" instead of a spinner; a failed history load says so instead of "No checks yet"; the history search and All/Scams/Safe filters work. | `src/screens/rao/evidence.tsx`, `hold.tsx`, `history.tsx` |

## How a message is checked

`src/lib/check/pipeline.ts`:

1. **Normalise** (`normalize.ts`): undo `acc0unt`-style digits, look-alike letters, `K.Y.C` spacing and zero-width characters. It keeps a map back to the original text so phrases can be highlighted.
2. **Hard rules → SCAM straight away.** `rules.ts` and `links.ts`:
   - secrecy **and** payment together (the design's "floor");
   - a request for an OTP, PIN or CVV, or for a screen-sharing app;
   - a link that copies a bank or brand (`sbi-kyc-verify.in`), or a site on the blocklist (`src/data/blocklist.json`, plus domains families reported and a reviewer blocked).
3. **Soft rules → spam percentage.**
   - Signal points: Secrecy 25, Payment 25, Authority 15, Fear 15, plus a risky link (20) or an unknown link (10).
   - The fast-gate model (TF-IDF + logistic regression, `gate.ts`, under 1 ms) gives a probability.
   - Spam % = the higher of the two. **70% or more with at least one phrase = SCAM. 30–69% = SUSPICIOUS (ask family). Below 30% = SAFE.**
4. **Claude, only for SUSPICIOUS.** If `ANTHROPIC_API_KEY` is set, `claude-haiku-5-5` reads the message:
   - it uses structured output and has a 2.5 s timeout with no retries;
   - its phrases must appear word for word in the message;
   - it can **raise** the verdict, never lower it.
   - If it is missing, slow, cut off or refuses, the screen shows "Checked by rules only — AI unavailable".

Thresholds and points live in `src/lib/check/config.ts`. Tune them on `/tests`. All wording people see comes from templates in `copy.ts`, never from the AI.

What happens after the verdict (`src/lib/server/checks.ts`):

| | Pasted message | Message arriving in the simulated inbox |
|---|---|---|
| SCAM | STOP screen. Urgent alert to every linked person. A 10-minute **hold** if the message names an amount. | Banner. A quiet **heads-up** to family (if "Tell Arjun automatically" is on). The hold starts if he taps "Pay anyway". |
| SUSPICIOUS | "Ask Arjun" sends a question. Arjun answers "scam" or "not a scam". | Same, from the banner's "Tell Arjun". |
| SAFE | Done ("Ask Arjun anyway" is still there). | Shown as SAFE in the inbox. |

**The family's answer decides what Papa sees** (`src/lib/server/answers.ts`). Every trusted person who was alerted or asked answers on their own phone. Blocking a payment counts as "scam"; approving it counts as "not a scam".
- **One "It's a scam" (or one Block) settles it as a SCAM**, straight away, for everyone.
- **"Not a scam" (or Approve) counts only when everyone who was alerted says so.** Until then Mr Rao keeps the automatic verdict and sees each answer and who we are waiting for; a paused payment stays paused.
- When everyone agrees, Mr Rao sees "Arjun and Meera checked it. It is not a scam." (green, with what the app had flagged still listed below), and a paused payment is released (demo).
- Clearing a message the app called SCAM needs a second confirm. While a payment is paused, answers are given on the payment screen (Block / Approve). Someone linked after the alert cannot clear it.

Holds:
- The first decision wins: Block, or Approve (which needs a second confirm).
- After 10 minutes a hold reads as **expired** but the money stays held. Block still works; Approve does not.
- Expiry is derived from `expires_at`, so no background job is needed.
- The first family answer to a question wins, and Mr Rao sees the first advice.

**Privacy and the shared message:**
- For every check the server stores a keyed fingerprint, the verdict and the warning phrases.
- **The full text of a SCAM or SUSPICIOUS message** is also kept, **for 24 hours**, so the family members who are alerted or asked can read exactly what was received (I2, J2, I4, O2) once they open the alert. Nobody else can read it, including people linked later. After 24 hours it is deleted.
- **Safe messages' text is never kept.** "Ask Arjun anyway" sends the text along from the phone, and the server only accepts it if it matches the checked message's fingerprint.
- Pasted text also stays in the phone's `sessionStorage`, so "Why we think so" can highlight it.
- The simulated inbox stands in for the phone's own SMS app and only holds made-up messages.
- The privacy screen (P3) says all of this in plain words.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript. CSS ported from the design system (`src/app/globals.css`). Installable as a PWA (manifest). |
| Polling | TanStack Query, every 2 s (`/api/me/state`, `/api/family/state`), as in the design |
| API | Next.js Route Handlers (`src/app/api/**`). Logic in `src/lib/server/*`. Zod validation. |
| Database | PostgreSQL through Drizzle ORM. PGlite (embedded) locally and in tests; Neon in production. Migrations in `drizzle/`. |
| Model | `ml/`: Python trains, JSON is exported, TypeScript scores. See `ml/README.md` for data, licences and retraining. |
| AI | Anthropic TypeScript SDK, `claude-haiku-5-5` (live) and `claude-sonnet-5-5` (`/tests` "final" run) |
| Tests | Vitest (rules, pipeline, model parity, server flow, 40-message quality gate). Playwright three-phone end-to-end (Mr Rao, Arjun, Meera). |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) and Vercel (`vercel.json`) |

## Project layout

```
src/app/(auth)/        welcome, sign-in, role (A0–A2)
src/app/(rao)/         Mr Rao's phone: home, check/[id]/…, hold/[id], history, settings, setup, inbox
src/app/family/        Arjun's phone: home, join, alerts-setup, alert/[id], hold/[id], check/[id], activity, settings
src/app/tests, demo, campaigns, reports   operator pages (L1, L2, F3b, F9b)
src/app/api/           route handlers
src/screens/           the screens, one file per area (phase2.tsx and operator-phase2.tsx hold the F screens)
src/lib/check/         normalise, rules, links, fast gate, Claude reader, pipeline, wording
src/lib/i18n/          English, Hindi and Telugu dictionaries for Mr Rao's screens (F5)
src/lib/server/        sessions, checks, holds, people/invites, simulated inbox, state, demo reset, test runs,
                       sightings (F3), reports (F9), calls (F6), ledger (F12), ops (F4, F7)
src/lib/db/            Drizzle schema and client
src/data/              examples, 40-message test set, simulated inbox messages, blocklist, gate model, synthetic campaigns
ml/                    fast-gate training (Python) and seeds
e2e/                   three-phone Playwright test
```

## Tests

```bash
pnpm test        # unit tests: rules, pipeline, model parity, server flow, phase 2 flows, devices, push, service worker, quality gate
pnpm eval        # prints every example and test message with its verdict and scores
pnpm build && pnpm e2e   # two browser "phones" against a fresh in-memory database
pnpm e2e:headed          # same, in visible windows side by side, slowed down to watch
pnpm ml:all              # retrain the fast-gate model (download → prepare → train)
pnpm push:keys           # print a VAPID key pair for Web Push
pnpm share               # public HTTPS link to the running app (Cloudflare quick tunnel)
```

Current results with rules and the model only (no AI): **20/20 scams caught, 0 false alarms**. 2 genuine messages land in SUSPICIOUS (a bank debit alert and a police advisory). 38 of 40 are answered without needing Claude.

## CI/CD

- **Every PR:** lint → type check → `pnpm test` (including the quality gate) → build → Playwright three-phone e2e.
- **On `main`, or a PR labelled `ai-eval`:** `pnpm eval --ai haiku`, run when the `ANTHROPIC_API_KEY` secret is set.
- **Deploy:** see [`docs/deploy.md`](docs/deploy.md) for the free-tier options (Vercel + Neon recommended, Railway, where it is live; its deploy settings are listed there). On Vercel: connect the repo. Each PR gets a preview URL, and `main` deploys to production. `vercel.json` runs `pnpm env:check && pnpm db:migrate && pnpm build` in the Singapore region.
- **Configuration check:** the server start (`src/instrumentation.ts`) and `pnpm env:check` (first step of the Vercel build; on Railway, add it before `pnpm db:migrate` in the pre-deploy command) run the same check (`src/lib/server/env.ts`) and name every problem at once: on a deployment (Vercel, Railway, Render, Fly.io, Cloud Run or `DEPLOYED=1`), a missing `DATABASE_URL`, `SESSION_SECRET`, `FINGERPRINT_SECRET` or `OPERATOR_KEY`; anywhere, a non-Postgres `DATABASE_URL`, half a VAPID key pair, a `VAPID_SUBJECT` that is not `mailto:`/`https://`, or a `DEMO_*_PHONE` that is not a 10-digit mobile number. A misconfigured deploy fails its build (or its health check), and the live version stays up. Short secrets and missing push or AI keys are warnings only.
- **Builds offline:** the four fonts are self-hosted in `src/app/fonts` (`next/font/local`, SIL OFL licences alongside), so `pnpm build` needs no network. A lint rule refuses `next/font/google`.
- **Logs:** server logs are one JSON object per line (`level`, `time`, `event`, fields; `src/lib/server/log.ts`), so the host's log search can filter on `event`. A failed API call answers with a short `ref` that is also in its `route_error` line; a page that fails shows the error screen with a reference that matches the `digest` of its `request_error` line. Logs never hold message text: errors keep their name, code, first message line and stack frames, and a failed query's parameters and a database error's detail are dropped.
- **Environment variables** for every Vercel environment:
  - `DATABASE_URL` (Neon, same region; the Neon–Vercel integration can create a branch per preview);
  - `SESSION_SECRET`, `FINGERPRINT_SECRET` (on Vercel, Railway, Render, Fly.io and Cloud Run the app refuses to run without them; on any other host set `DEPLOYED=1` to get the same check);
  - `OPERATOR_KEY` (needed for any public URL; a long random value);
  - optionally `ANTHROPIC_API_KEY`.

## On a phone

The web app is built for phones first and was crawled screen by screen at Pixel 7 (412×915) and iPhone SE (375×667) sizes: no horizontal overflow, no text input under 16px (which would make iPhones zoom), every button at least 44px tall, safe-area padding for notched phones, and no console errors on any screen.

- **Try it on your phone now:** `pnpm dev`, then open the "Network" URL Next prints (e.g. `http://192.168.x.x:3000`) on a phone on the same Wi-Fi.
- **Install it:** on Android Chrome, menu → "Add to Home screen" (the manifest has 192/512 px and maskable icons); on iPhone Safari, Share → "Add to Home Screen". Installed, it opens full screen without the browser bar.
- **Sound and vibration** play only after the person has tapped the page once since it loaded; that is a browser rule, not ours. The screen flash always works. The family setup screen's "Send me a test alert" is that first tap.
- **Calls** open the dialer (`tel:` links). Vibration works on Android; iPhones flash and play sound instead.
- **Signed-out visits** are redirected on the server to `/welcome` (no API call, no 401).

## On real phones, with several people, today

Everyone (Mr Rao, Mrs Rao, Arjun, Meera, or your own teammates with their own numbers) needs the **same URL** on their phone. Three ways, from quickest to most lasting:

1. **Same Wi‑Fi (no setup):** `pnpm dev`, open the "Network" URL (`http://192.168.x.x:3000`) on each phone. Alerts work while the app is open; push needs HTTPS, so it is off here.
2. **Any network, in a minute (demo):** in a second terminal run `pnpm share`. It prints a public `https://….trycloudflare.com` link (Cloudflare quick tunnel, no account) that forwards to your laptop. Everyone opens it, installs the app from the browser menu, and push notifications work because the link is HTTPS. The link changes each time you run it, and dies when you close it.
3. **A lasting URL (recommended before the demo day; options and costs in [`docs/deploy.md`](docs/deploy.md)):** connect the GitHub repo to Vercel and create a Neon Postgres database. Set these environment variables in Vercel: `DATABASE_URL`, `SESSION_SECRET`, `FINGERPRINT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (from `pnpm push:keys`), the `DEMO_*_PHONE` numbers and optionally `ANTHROPIC_API_KEY`. Every push to `main` deploys; every PR gets a preview link.

**Each user on their own phone:**
- Mr Rao's phone: sign in (any 10-digit number, code `1234`), choose "I want protection", add trusted people with their real numbers, share the codes.
- Each trusted person: sign in with the number Mr Rao entered, choose "I protect someone", enter the code, turn on **Notifications** on the "So we can reach you fast" screen (the phone asks for permission), tap **Send me a test alert**: it should ring *and* appear in the notification bar.
- iPhones: push only works once the app is installed (Share → Add to Home Screen); the screen says so.

**Alerts when the app is closed (Web Push)** are built in: see "Push notifications" below. Without VAPID keys the app simply skips push.

## Push notifications (alerts when the app is closed)

Every alert the app creates also goes out as a Web Push notification, so the person is told even when the app is in the background, the phone is locked, or the app is closed. Nothing changes for a phone that has the app open: it still polls every 2 s, buzzes, flashes and opens the alert by itself.

**What is pushed, and to whom**

| What happened | Who is told | The notification | A tap opens |
|---|---|---|---|
| A scam was pasted, forwarded or spoken; "Pay anyway"; the live-call guard | every linked family member (urgent) | "Papa needs you now", with **Block payment** and **It's fine** when a payment is paused (F2) | the paused payment, or the message |
| A detected message (Android watcher, simulated inbox) is a scam and "Tell Arjun automatically" is on | family members with the early heads-up (quiet) | "Heads-up: Papa got a scam message" | the message |
| "Ask Arjun" | every linked family member (quiet) | "Papa is asking: is this message safe?" | the message, with the answer buttons |
| A detected message is SCAM or SUSPICIOUS | Mr Rao's own phone, in his language (F5) | "Possible scam from +91 9XXXX XXXXX" | his verdict screen |
| The family blocked or released a paused payment, or answered an "Ask" | Mr Rao's own phone, in his language | "Payment cancelled: Arjun blocked the Rs 80,000 payment" | the payment, or the verdict |

Safe messages are never pushed. A newer notification about the same message replaces the older one in the tray (the quiet heads-up goes when the urgent alert for the forwarded message arrives), and notifications for alerts that were handled in the app, by this person or the other sibling, are cleared.

**Tap to open.** A family notification points at `/open/<alertId>`: a small resolver page (`src/screens/family/open.tsx`, `POST /api/family/alerts/[id]/open`) that marks the alert opened and goes straight to the paused payment (`/family/hold/…`) or the message (`/family/check/…`), never the home screen, also when the alert was already handled (it then shows the outcome). The service worker reuses the window that already shows that part of the app, or opens a new one when the app is closed, so a closed app initialises on the right screen. A signed-out phone keeps the destination through the welcome and sign-in screens (`pending-open.ts`). Someone else's alert goes home. Mr Rao's notifications point straight at `/check/<id>` or `/hold/<id>`.

**Phones, people and preferences.** One subscription per browser, stored in `push_subscriptions` and keyed by endpoint. The phone re-sends it on every app start, so it always belongs to the person signed in; signing out removes it (`POST /api/auth/sign-out` carries the endpoint) and the next sign-in registers the phone afresh, without asking for permission again. A subscription made with an older VAPID key is replaced; the browser's `pushsubscriptionchange` re-subscribes and the old endpoint is forgotten; a phone the push service reports gone (404, 410) is deleted. The **Notifications** toggle (family: "So we can reach you fast" and Settings; Mr Rao: Settings) is honoured on the server (`users.alert_notify`), so a second phone of the same person stays quiet too. "Send me a test alert" ignores the toggle on purpose. (The demo panel runs several phones in one browser, which has one subscription: it belongs to whichever frame registered last, so test push on real phones.)

**Reliability.** Each delivery is written to `push_deliveries` (sent; failed, with the push service's status and error; or gone), with the alert and an idempotency key (`alert:<id>`, `check:<id>`, `hold:<id>:<status>`), so the same alert is never pushed twice to one phone and a missing notification can be traced. A temporary failure (429, 5xx, network) is retried once, honouring a short `Retry-After`. A push never fails an alert: the in-app alert, the hold and the event log are written first. The demo panel's event log shows "Push notification sent to N phones" and "Push notification failed for N phones".

**Fallback.** Without VAPID keys, or when permission is denied, not yet given, or not possible (Safari in the browser), everything else works: the open app still polls, buzzes, flashes and opens alerts. The family home then shows a card saying alerts reach the phone only while the app is open, with the one tap that fixes it; the settings say what is blocking it.

**Setup and deployment**
- Environment variables, on every Vercel environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (print a pair with `pnpm push:keys`). Rotating the keys is safe: phones re-subscribe on their next app start.
- Database: migration `drizzle/0007_push_deliveries.sql` (`pnpm db:migrate`, which the Vercel build runs; the embedded database migrates itself).
- HTTPS is required (Web Push works on `localhost` and over `pnpm share`, not on a LAN `http://` address).
- Android: the Android app opens the site in Chrome (Trusted Web Activity), so Chrome asks for the notification permission, shows the notifications and the tap opens the app on the alert. No Firebase. With `/.well-known/assetlinks.json` verified (`ANDROID_CERT_SHA256`) it opens full screen inside the app.
- iPhone: install to the home screen first (iOS 16.4+), then turn Notifications on; the screen says so.

**Test matrix** (the scenarios in the brief)

| Scenario | What happens | Where it is tested |
|---|---|---|
| The recipient is using the app | The poll opens the alert and plays the alarm; the tray notification is cleared once the alert is handled | `flow.test.ts`, e2e "scam: STOP…", `sw.test.ts` |
| Another app is open · the app is in the background | The notification shows; a tap focuses the app's window and navigates it to the alert | `sw.test.ts` "opens the alert in the family window" |
| The phone is locked | Urgent notifications stay until handled; **Block payment** works from the lock screen | e2e "F2 lock screen", `sw.test.ts` "Block payment" |
| The app was closed | A tap opens a new window on `/open/<id>`, which initialises the app on the payment or the message | `sw.test.ts` "with the app closed", e2e "push notification tap" |
| A tap reaches the correct alert | `/open/<id>` resolves to the hold or the check, also once handled; someone else's alert goes home; signed out keeps the destination | `push.test.ts` "the tap opens…", e2e "push notification tap" |
| Several alerts in succession | One notification per alert; a newer one about the same message replaces the older; never the same alert twice to one phone | `sw.test.ts` "replaces the older one", `push.test.ts` "never … twice" |
| The token changes or is invalid | `pushsubscriptionchange` re-subscribes; `previousEndpoint` is forgotten; 404/410 deletes the phone; a key change replaces the subscription | `sw.test.ts` "subscription changes", `push.test.ts` "forgets…", "a replaced endpoint" |
| Permission is denied | Status "denied"; the home card and the settings say so; alerts still work while the app is open | `push.ts` client, `PushHint` (manual: deny in the browser) |
| Sender and recipient on different devices | Subscriptions are per phone and per person; every phone of the person is told | `push.test.ts` "sends to every phone" |
| The recipient logs out and another user logs in | Sign-out removes this phone; the next sign-in moves the endpoint to the new person | `push.test.ts` "a phone another person signs in on" |
| Temporary delivery errors | One retry on 429/5xx/network; status and error logged in `push_deliveries` | `push.test.ts` "retries once" |

## The Android app (APK)

`android/` is a small native app, built with Gradle (see `android/README.md`):

- It opens the web app **full screen inside Chrome** (a Trusted Web Activity), so push notifications, the dialer, vibration and every screen work unchanged, with no Firebase and no WebView.
- Its **message watcher** is the real version of the simulated inbox (screens M1–M4): after the person allows notification access, it reads new SMS and WhatsApp notifications and posts them to `POST /api/device/inbox`; the same check runs and the family gets its heads-up.
- **Connect this phone** (`Settings › Watch my messages`) shows a 15-minute code; the app trades it for a token (`/api/device/pair`) and reports whether notification access is on (`/api/device/status`). Only a hash of the token is stored.

Build: `cd android && ./gradlew assembleDebug -PPB_HOST=https://your-deployment` → `app/build/outputs/apk/debug/app-debug.apk` (about 5 MB). CI builds it on every push ("Android APK (debug)" artifact). Full-screen mode needs `/.well-known/assetlinks.json`, served from `ANDROID_CERT_SHA256`. The user manual is published as an artifact (link in the project chat) and summarised in `android/README.md`.

**Still native-only, not done:** FCM push with a full-screen "incoming call" alert that rings through Do Not Disturb (Web Push covers the normal case), and a Play Store listing (needs the notification-access disclosure and a release key).

## Deliberate choices and limits in phase 1

- **Calls go through the phone's dialer.** The app never places a call itself: the person confirms in the dialer. Set the demo numbers before a live demo (see "Calls" above).
- **Still open after phase 2:** quiet hours and escalation calls (O3); FCM full-screen alerts that ring through Do Not Disturb; native call detection (the live-call guard asks questions instead of listening to the call); Play Store listing. Hindi and Telugu strings were machine-written and need a native speaker's sign-off.
- **Operator pages need a key on a public URL.** Set `OPERATOR_KEY`: `/demo`, the `/tests` runs, "Reset demo data" and the Block/Reject review on `/reports` then ask for it once per browser tab. The read-only operator pages (`/campaigns`, the `/reports` list) stay open, and so does everything on a laptop without the key.
- **Demo sign-in stays open.** "Continue as Mr Rao (demo)" and the code 1234 need no key, so anyone with a public URL can still run checks (and have Claude read the unsure ones, if a key is set). Put the whole site behind a password, or remove the demo sign-in, before a real launch.
- **The rules are a starting point.** The test set is small and team-written, and the training data is synthetic. Treat the numbers as a sanity check, not real-world accuracy.
- **Claude refusals and timeouts fall back to rules only.** No refusal fallback model is configured.
