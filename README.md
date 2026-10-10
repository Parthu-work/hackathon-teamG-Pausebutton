# Pause Button: simulator and Android app

A calm second opinion before the money moves. An older person (Mr Rao) checks a worrying message. If it is a scam, the app stops him, pauses the payment and alerts his family (Arjun, Meera). Arjun then blocks or approves the payment from his own phone.

The **simulator** is a web app that runs on any phone or laptop. It has no real SMS, no real money and no real calls; every message is made up. The screens follow the design file: phase 1 (screens A–L, P, Q and parts of N/O), the Android watcher (M), and the phase 2 feature proposals F1–F14 (see "Phase 2" below).

The **Android app** (`android/`) is the same web app inside a Capacitor WebView, with no browser bar, plus what only a phone can do: the message watcher (M), push through Firebase Cloud Messaging, and a sync every 30 minutes (see "The Android app" below).

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

**Sign-in is demo-only.** Use "Continue as Mr Rao / Mrs Rao / Arjun / Meera (demo)", or type any 10-digit number and tap **Send code**. No SMS is sent: in demo mode the random 4-digit code is shown on the next screen, once (not again after a reload or Back). It works for 5 minutes and locks after 5 wrong tries; **Resend code** is possible after 30 s and retires the old code (`src/lib/server/otp.ts`; only a keyed hash of the code is stored). A new number goes through "Who is this phone for?", where a **name is required**: both home screens greet by it ("Good morning, Ramesh"; `src/lib/display-name.ts` takes the first name, and an old account still named "Guest" gets the plain greeting). Then the setup and invite screens. Signed in, `/welcome` and `/sign-in` send the person home. The demo household: Mr Rao ("Papa") and Mrs Rao ("Mummy") are both protected by Arjun and Meera, so each family phone shows a **"Who you protect"** list with one card per parent; Mr Rao's friend Dinesh is invited but waiting. Invite codes: Mr Rao's `PB-4K7Q` (Arjun), `PB-9M2X` (Meera), `PB-7H3D` (Dinesh); Mrs Rao's `PB-2M8R` (Arjun), `PB-5T6W` (Meera). A family member links another person from Settings → "Link another person".

**Two real phones:** run `pnpm dev`, then open the "Network" URL that Next prints (same Wi-Fi) on both phones. Sign one in as Mr Rao and the other as Arjun. Tap Arjun's screen once so it is allowed to play sound.

**Calls:** every "Call Arjun", "Call Papa" and "Call cyber helpline 1930" button opens the phone's dialer with the number filled in; the person still taps the green call button. On a laptop (and in `/demo`) it shows the number instead.
- The numbers come from the trusted people Mr Rao added and from the sign-in number.
- The demo personas use placeholder numbers that may belong to strangers. Before a live demo, put your teammates' real numbers in `.env.local` (`DEMO_RAO_PHONE`, `DEMO_MOM_PHONE`, `DEMO_ARJUN_PHONE`, `DEMO_MEERA_PHONE`) and restart `pnpm dev`.
- Family phones call the parents by nickname ("Papa", "Mummy": `users.nickname`, set for the demo personas); friends see the name.

### Demo script (about 2 minutes)

`/demo` shows three phones: the left one switches between **Mr Rao (Papa)** and **Mrs Rao (Mummy)**, then **Arjun** (son) and **Meera** (daughter). Tap Arjun's and Meera's phones once so they may play sound.

1. Press **Reset demo data**.
2. On Mr Rao's phone, tap **CBI parcel call** → **Check this message**. He sees **STOP**, then the SCAM verdict with "47 other families got this today" (F3). Rs 80,000 is above the two-key line (F13), so it is paused for Mr Rao's payment hold time (10 minutes unless changed in Settings) and release needs both Arjun and Meera.
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
| F2 | **Lock-screen alerts with Block built in**: the push notification for a paused payment (Web Push in a browser, FCM in the Android app) carries **Block payment** and **It's fine**; Block works in the service worker, or in the app's own notification, without opening the app and answers "You blocked it". "It's fine" opens the approve step (approving always needs the second confirm). The simulator's `/family/lock` is the same notification on a locked phone. | `public/sw.js`, `android/…/PushAlert.java`, `src/screens/family/phase2.tsx` |
| F3 | **Campaign radar**: every scam or suspicious check records a sighting (fingerprint + household key, never text). The verdict says "N other families got this today"; `/campaigns` lists campaigns by fingerprint. | `src/lib/server/sightings.ts` |
| F4 | **Disagreement report**: `/tests → Disagreements` groups every check with a family answer by the stage that decided it (hard rule, score band, Claude) and lists the scams a family approved, signals only. | `src/lib/server/ops.ts` |
| F5 | **Hindi and Telugu, for real**: Settings → Language. Every Mr Rao screen and warning reads from one dictionary per language (`src/lib/i18n`); verdict copy comes back from the server in his language; family screens stay English. Native-speaker sign-off is still required before shipping; the strings this release added or changed are listed for it in [docs/i18n-review.md](docs/i18n-review.md). | `src/lib/i18n/*.ts`, `src/screens/rao/language.tsx` |
| F6 | **Live-call guard**: "Someone is calling me" on the home screen. Three yes/no questions; any yes convicts the call (hard rule `live_call`), the family gets an urgent "Papa is on a scam call" alert, and the answers become a short account the rules highlight. | `src/lib/server/calls.ts`, `src/screens/rao/call.tsx` |
| F7 | **Measure the scam family**: Claude's `scam_type` is now stored (`checks.ai_scam_type`); `/tests → Families` compares our regex family with Claude's name for the trick on the last Claude run. | `src/lib/server/ops.ts` |
| F8 | **Novel-scam escape hatch**: when no rule and no link matched and Claude's quoted words convict it, the check is marked `novel`; the verdict shows **NEW TRICK**, "The words that gave it away" (verified letter by letter) and "None of our usual rules matched". | `src/lib/check/pipeline.ts` |
| F9 | **Family-reported domains**: an alerted member reports the link in two taps; `/reports` is the review queue; **Block** adds the domain to the live blocklist the checker reads on every check (no redeploy). Official sites are refused on sight. | `src/lib/server/reports.ts`, `src/lib/check/links.ts` |
| F10 | **Speak and listen**: "Read it aloud" on every verdict (speech synthesis, in his language); "Speak instead of typing" on the home screen (speech recognition, Chrome). | `src/lib/client/speech.ts`, `src/screens/rao/speak.tsx` |
| F11 | **Advice in his own words**: the chips fill a textarea (200 characters); **Send and block this payment** / **Send and call Papa**. The same box sits under "It's a scam" on the heads-up screen. | `src/screens/family/screens.tsx` |
| F12 | **The household ledger**: "This month: N payments paused · Rs X held" and "What we stopped" on the family home; `/family/month` is the monthly note with the fastest answer and the scams going around, with **Share this with the family**. | `src/lib/server/ledger.ts` |
| F13 | **Two keys for large amounts**: above Rs 50,000 (`TWO_KEY_AMOUNT`) both phones say "This one needs two of you", and "Who has decided" is always shown. The countdown is the same payment hold time as any other hold. One Block still stops it; release needs every trusted person. | `src/lib/server/holds.ts` |
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
| SCAM | STOP screen. Urgent alert to every linked person. A **hold** for the person's payment hold time (5, 10, 15, 30 or 60 minutes; 10 by default) if the message names an amount. | Banner. A quiet **heads-up** to family (if "Tell Arjun automatically" is on). The hold starts if he taps "Pay anyway". |
| SUSPICIOUS | "Ask Arjun" sends a question. Arjun answers "scam" or "not a scam". | Same, from the banner's "Tell Arjun". |
| SAFE | Done ("Ask Arjun anyway" is still there). | Shown as SAFE in the inbox. |

Family is told automatically about a SCAM only (D6); a suspicious or safe message reaches them when Mr Rao asks. A watcher message the server **could not check** shows in the inbox as "We could not check this message · Tap to check it again" (see "The sync safety net").

**The family's answer decides what Papa sees** (`src/lib/server/answers.ts`). Every trusted person who was alerted or asked answers on their own phone. Blocking a payment counts as "scam"; approving it counts as "not a scam".
- **One "It's a scam" (or one Block) settles it as a SCAM**, straight away, for everyone.
- **"Not a scam" (or Approve) counts only when everyone who was alerted says so.** Until then Mr Rao keeps the automatic verdict and sees each answer and who we are waiting for; a paused payment stays paused.
- When everyone agrees, Mr Rao sees "Arjun and Meera checked it. It is not a scam." (green, with what the app had flagged still listed below), and a paused payment is released (demo).
- Clearing a message the app called SCAM needs a second confirm. While a payment is paused, answers are given on the payment screen (Block / Approve). Someone linked after the alert cannot clear it.

Holds:
- **Payment hold time** is a setting: Settings › Payment hold time on Mr Rao's phone, and "Papa's payment hold time" in a family member's Settings, one row per person they protect. Choices are 5, 10, 15, 30 or 60 minutes (`HOLD_CHOICES`, default `DEFAULT_HOLD_MINUTES` = 10, in `src/lib/check/config.ts`). A change applies to the next hold; a running hold keeps its end time. The change is written to the household activity log. API: `PATCH /api/me/settings {holdMinutes}` and `PATCH /api/family/settings {hold: {protectedId, minutes}}`; any other value is a 400, a person not linked a 403. "Reset demo data" puts the demo personas back to 10.
- The first decision wins: Block, or Approve (which needs a second confirm).
- When its time runs out a hold reads as **expired** but the money stays held. Block still works; Approve does not.
- Expiry is derived from `expires_at`, so no background job is needed.
- The first family answer to a question wins, and Mr Rao sees the first advice.

**Privacy and the shared message** (the full policy, table by table: [docs/retention.md](docs/retention.md)):
- For every check the server stores a keyed fingerprint, the verdict, the warning phrases and who sent it.
- **The full text of a SCAM or SUSPICIOUS message** is also kept, **for 24 hours**, so the family members who are alerted or asked can read exactly what was received (I2, J2, I4, O2) once they open the alert. Nobody else can read it, including people linked later. After 24 hours it is unreadable, and the hourly purge (`POST /api/cron/purge`, called by the Uptime workflow) deletes it.
- **Safe messages' text is never kept**, with one exception the person chooses: "Ask Arjun anyway" sends the text along from the phone (the server only accepts it if it matches the checked message's fingerprint), and it is then kept like a scam message's text, for 24 hours.
- Messages from the Android watcher keep no text in the inbox table once they are checked. One the server **could not check** keeps its text for at most 24 hours, only so the sync job or Mr Rao's tap can check it again; nobody reads it meanwhile, and the purge clears it. A message that is not checked (an app not watched, a saved contact) is not stored at all. Only the made-up demo messages keep their text there.
- The activity log, the push delivery log and the sync job's run log (`sync_runs`) are deleted after 30 days. Sign-in codes (`otp_codes`, a keyed hash, never the code) are deleted after 24 hours.
- Pasted text also stays in the phone's `sessionStorage`, so "Why we think so" can highlight it.
- **Delete my history** and **Delete my account** (P3; J4 for family) remove what the policy says, and refuse to touch a payment that is still on hold.
- The privacy screen (P3) says all of this in plain words.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript. CSS ported from the design system (`src/app/globals.css`). Installable as a PWA (manifest). The Android app is a Capacitor 8 WebView around the deployed site (`capacitor.config.ts`, `android/`). |
| Polling | TanStack Query, every 2 s (`/api/me/state`, `/api/family/state`), as in the design |
| API | Next.js Route Handlers (`src/app/api/**`). Logic in `src/lib/server/*`. Zod validation. |
| Database | PostgreSQL through Drizzle ORM. PGlite (embedded) locally and in tests; Neon in production. Migrations in `drizzle/`. |
| Model | `ml/`: Python trains, JSON is exported, TypeScript scores. See `ml/README.md` for data, licences and retraining. |
| AI | Anthropic TypeScript SDK, `claude-haiku-5-5` (live) and `claude-sonnet-5-5` (`/tests` "final" run) |
| Tests | Vitest (rules, pipeline, model parity, server flow, sign-in codes, hold time, sync job, Web Push and FCM, 40-message quality gate). Playwright three-phone end-to-end (Mr Rao, Arjun, Meera), one worker. JUnit on the JVM and on an emulator for the Android app. |
| CI/CD | GitHub Actions (`.github/workflows/`: CI, Uptime, Sync, Publish APK) and Vercel (`vercel.json`); live on Railway |

## Project layout

```
src/app/(auth)/        welcome, sign-in (the number, then the 4-digit code), role (role and name) (A0–A2)
src/app/(rao)/         Mr Rao's phone: home, check/[id]/…, hold/[id], history, settings, setup, inbox, watch, watch/connect (M1–M4), privacy, speak, call
src/app/family/        Arjun's phone: home, join, alerts-setup, alert/[id], hold/[id], check/[id], person/[id], activity, settings, month, lock
src/app/tests, demo, campaigns, reports   operator pages (L1, L2, F3b, F9b)
src/app/download       the APK download page and its QR code
src/app/api/           route handlers (auth/code, auth/sign-in, cron/purge, cron/sync, device/*, me/inbox/[id]/retry, ops/*, push/*, …)
src/components/        shared UI; native-notifications.tsx (the Android app's "why" before Android's notification prompt)
src/screens/           the screens, one file per area (phase2.tsx and operator-phase2.tsx hold the F screens)
src/lib/check/         normalise, rules, links, fast gate, Claude reader, pipeline, wording; config.ts (thresholds, HOLD_CHOICES)
src/lib/client/        api, push (Web Push in a browser, FCM in the app), native (the PauseButtonNative bridge), speech, sw.test
src/lib/display-name.ts   the first name to greet by
src/lib/i18n/          English, Hindi and Telugu dictionaries for Mr Rao's screens (F5)
src/lib/server/        sessions, otp (sign-in codes), checks, holds, people/invites, simulated inbox (sim), devices (connected phones),
                       sync (the 30-minute job), retention (the purge), push (Web Push + FCM), ratelimit, env (config check), state,
                       demo reset, test runs, sightings (F3), reports (F9), calls (F6), ledger (F12), ops (F4, F7)
src/lib/db/            Drizzle schema and client
src/data/              examples, 40-message test set, simulated inbox messages, blocklist, gate model, synthetic campaigns
capacitor.config.ts    the Android app's Capacitor config: server.url from PB_HOST
capacitor/www          the placeholder page Capacitor needs (the WebView opens the site itself)
android/               the Android app: Capacitor shell, message watcher, native bridge plugin, FCM push, SyncWorker (android/README.md)
ml/                    fast-gate training (Python) and seeds
e2e/                   Playwright: family-phones (three phones), auth, hold-time, native-app, download
docs/                  deploy, push, retention, i18n-review
```

## Tests

```bash
pnpm test        # unit tests: rules, pipeline, model parity, server flow, phase 2 flows, devices, push, service worker, quality gate
pnpm eval        # prints every example and test message with its verdict and scores
pnpm build && pnpm e2e   # browser "phones" against a fresh in-memory database
pnpm e2e:headed          # same, in visible windows side by side, slowed down to watch
pnpm ml:all              # retrain the fast-gate model (download → prepare → train)
pnpm push:keys           # print a VAPID key pair for Web Push
pnpm share               # public HTTPS link to the running app (Cloudflare quick tunnel)
pnpm cap:sync            # write PB_HOST and the Capacitor plugins into the Android project (before a Gradle build)
pnpm android:build       # cap:sync, then the debug APK (needs JDK 21 and the Android SDK)
```

Unit tests added in this release: `otp.test.ts` (sign-in codes: once, 5 minutes, 5 tries, Resend, the sweep), `display-name.test.ts`, `holds.test.ts` (the hold time, two keys), `sync.test.ts` (exactly-once inbox, re-checks, re-push, quiet phones, the lease), `push.fcm.test.ts` (FCM sending against mocked Google endpoints), `env.test.ts` (the config check, `FCM_SERVICE_ACCOUNT`). Playwright specs: `family-phones.spec.ts` (the three phones), `auth.spec.ts` (sign-in with the code shown on screen, the name, the greeting, Back), `hold-time.spec.ts`, `native-app.spec.ts` (the Android app's web half against a stand-in Capacitor bridge), `download.spec.ts`. Playwright runs **one worker** (`workers: 1`): the specs share one server and one demo household, and each test resets it. The Android app's own tests: `cd android && ./gradlew testDebugUnitTest` (JVM) and `connectedDebugAndroidTest` (emulator), after `pnpm cap:sync`.

Current results with rules and the model only (no AI): **20/20 scams caught, 0 false alarms**. 2 genuine messages land in SUSPICIOUS (a bank debit alert and a police advisory). 38 of 40 are answered without needing Claude.

## CI/CD

- **Every PR** (`.github/workflows/ci.yml`): lint → type check → `pnpm test` (including the quality gate) → build → Playwright e2e (one worker). Two Android jobs run alongside: **Android APK** (`pnpm cap:sync`, the watcher's JVM unit tests, then the debug and release APKs with JDK 21 and Android SDK 36; the debug APK is the `pause-button-debug-apk` artifact; without the `GOOGLE_SERVICES_JSON` secret the APK has no push and the job warns) and **Android message watcher on an emulator** (Android 14: dedup and the outbox across a restart, the Idempotency-Key, pairing, removal, disconnect, the 30-minute sync).
- **Every hour** (`.github/workflows/uptime.yml`): an uptime check of the live site; a failure opens a "The live site is down" issue. The same run calls the purge (`POST /api/cron/purge`).
- **Every 30 minutes** (`.github/workflows/sync.yml`): the sync job, `POST /api/cron/sync` with `Authorization: Bearer <CRON_SECRET>`, the same secret as the purge. Without the secret the step fails and says so. See "The sync safety net".
- **When the app changes on `main`** (`android/`, `capacitor.config.ts`, `capacitor/` or `package.json`; or by hand from the Actions tab, with a host to build for): `.github/workflows/publish-apk.yml` builds the APK for the live site (`PB_HOST=… pnpm cap:sync`, Gradle), checks it opens that site and is signed with the shared debug key, commits it as `public/pause-button.apk` and waits until the site serves it.
- **On `main`, or a PR labelled `ai-eval`:** `pnpm eval --ai haiku`, run when the `ANTHROPIC_API_KEY` secret is set.
- **Repository secrets and variables:** `CRON_SECRET` (purge and sync), `GOOGLE_SERVICES_JSON` (the Firebase app file, raw or base64; the APK has push only with it), optionally `ANTHROPIC_API_KEY`; the variable `PB_HOST` is the site the APK opens (default: the Railway URL).
- **Deploy:** see [`docs/deploy.md`](docs/deploy.md) for the free-tier options (Vercel + Neon recommended, Railway, where it is live; its deploy settings are listed there). On Vercel: connect the repo. Each PR gets a preview URL, and `main` deploys to production. `vercel.json` runs `pnpm env:check && pnpm db:migrate && pnpm build` in the Singapore region.
- **Configuration check:** the server start (`src/instrumentation.ts`) and `pnpm env:check` (first step of the Vercel build; on Railway, add it before `pnpm db:migrate` in the pre-deploy command) run the same check (`src/lib/server/env.ts`) and name every problem at once: on a deployment (Vercel, Railway, Render, Fly.io, Cloud Run or `DEPLOYED=1`), a missing `DATABASE_URL`, `SESSION_SECRET`, `FINGERPRINT_SECRET` or `OPERATOR_KEY`; anywhere, a non-Postgres `DATABASE_URL`, half a VAPID key pair, a `VAPID_SUBJECT` that is not `mailto:`/`https://`, an `FCM_SERVICE_ACCOUNT` that is not a Firebase service account file with a PEM private key, or a `DEMO_*_PHONE` that is not a 10-digit mobile number. A misconfigured deploy fails its build (or its health check), and the live version stays up. Short secrets, a missing AI key, and no push set up at all (neither VAPID keys nor `FCM_SERVICE_ACCOUNT`) are warnings only.
- **Builds offline:** the four fonts are self-hosted in `src/app/fonts` (`next/font/local`, SIL OFL licences alongside), so `pnpm build` needs no network. A lint rule refuses `next/font/google`.
- **Logs:** server logs are one JSON object per line (`level`, `time`, `event`, fields; `src/lib/server/log.ts`), so the host's log search can filter on `event`. A failed API call answers with a short `ref` that is also in its `route_error` line; a page that fails shows the error screen with a reference that matches the `digest` of its `request_error` line. Logs never hold message text: errors keep their name, code, first message line and stack frames, and a failed query's parameters and a database error's detail are dropped.
- **Environment variables** for every Vercel environment:
  - `DATABASE_URL` (Neon, same region; the Neon–Vercel integration can create a branch per preview);
  - `SESSION_SECRET`, `FINGERPRINT_SECRET` (on Vercel, Railway, Render, Fly.io and Cloud Run the app refuses to run without them; on any other host set `DEPLOYED=1` to get the same check);
  - `OPERATOR_KEY` (needed for any public URL; a long random value);
  - `CRON_SECRET` (the purge and the sync job; the same value as the repository secret);
  - `DEMO_SIGNIN` only if this deployment should offer demo sign-in (`on`); unset, every deployment keeps it off;
  - `OTP_PROVIDER`: who delivers the sign-in codes. `demo` (the default) shows the code on screen, and only while demo sign-in is on; `sms` is a placeholder that answers 503 "Sign-in codes by SMS are not set up on this site yet." until a provider is wired in;
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` for Web Push, and `FCM_SERVICE_ACCOUNT` for the Android app (see "Push notifications");
  - optionally `ANTHROPIC_API_KEY`.
- **Database migrations** run in order on every deploy (`pnpm db:migrate`; Railway's pre-deploy command, the Vercel build). The latest are `drizzle/0010_sim_text_retention.sql` and `drizzle/0011_old_solo.sql`: the `otp_codes` and `sync_runs` tables, `users.hold_minutes`, the watcher inbox's `status`, `error`, `attempts`, `last_tried_at` and `device_message_id` (unique per person, for the Idempotency-Key), `push_subscriptions.kind` (`webpush` or `fcm`), `alerts.repushed_at`, and the phones' `not_syncing_since`, `last_sync_at` and `waiting`.

## On a phone

The web app is built for phones first and was crawled screen by screen at Pixel 7 (412×915) and iPhone SE (375×667) sizes: no horizontal overflow, no text input under 16px (which would make iPhones zoom), every button at least 44px tall, safe-area padding for notched phones, and no console errors on any screen.

- **Try it on your phone now:** `pnpm dev`, then open the "Network" URL Next prints (e.g. `http://192.168.x.x:3000`) on a phone on the same Wi-Fi.
- **Install it:** on Android, the app from `/download` (the APK; it opens the site with no browser bar, and adds the watcher and push through Firebase) or Chrome's menu → "Add to Home screen" (the manifest has 192/512 px and maskable icons); on iPhone Safari, Share → "Add to Home Screen". Installed, it opens full screen without the browser bar.
- **Sound and vibration** play only after the person has tapped the page once since it loaded; that is a browser rule, not ours. The screen flash always works. The family setup screen's "Send me a test alert" is that first tap.
- **Calls** open the dialer (`tel:` links). Vibration works on Android; iPhones flash and play sound instead.
- **Signed-out visits** are redirected on the server to `/welcome` (no API call, no 401).

## On real phones, with several people, today

Everyone (Mr Rao, Mrs Rao, Arjun, Meera, or your own teammates with their own numbers) needs the **same URL** on their phone. Three ways, from quickest to most lasting:

1. **Same Wi‑Fi (no setup):** `pnpm dev`, open the "Network" URL (`http://192.168.x.x:3000`) on each phone. Alerts work while the app is open; push needs HTTPS, so it is off here.
2. **Any network, in a minute (demo):** in a second terminal run `pnpm share`. It prints a public `https://….trycloudflare.com` link (Cloudflare quick tunnel, no account) that forwards to your laptop. Everyone opens it, installs the app from the browser menu, and push notifications work because the link is HTTPS. The link changes each time you run it, and dies when you close it.
3. **A lasting URL (recommended before the demo day; options and costs in [`docs/deploy.md`](docs/deploy.md)):** connect the GitHub repo to Vercel and create a Neon Postgres database. Set these environment variables in Vercel: `DATABASE_URL`, `SESSION_SECRET`, `FINGERPRINT_SECRET`, `OPERATOR_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (from `pnpm push:keys`), the `DEMO_*_PHONE` numbers and optionally `ANTHROPIC_API_KEY` and `FCM_SERVICE_ACCOUNT` (push to the Android app). Every push to `main` deploys; every PR gets a preview link.

**Each user on their own phone:**
- Mr Rao's phone: sign in with any 10-digit number and the code shown on screen (demo mode; on a deployment this needs `DEMO_SIGNIN=on`), enter a name, choose "I want protection", add trusted people with their real numbers, share the codes. On Android, install the app from `/download` first so the watcher can be connected.
- Each trusted person: sign in with the number Mr Rao entered, choose "I protect someone", enter the code, turn on **Notifications** on the "So we can reach you fast" screen (the phone asks for permission), tap **Send me a test alert**: it should ring *and* appear in the notification bar.
- iPhones: push only works once the app is installed (Share → Add to Home Screen); the screen says so.

**Alerts when the app is closed** are built in: Web Push for browsers and the iPhone home-screen app, FCM for the Android app; see "Push notifications" below. Without VAPID keys or `FCM_SERVICE_ACCOUNT` the app simply skips push.

## Before a release: three real phones

CI proves the logic (unit tests, the 40-message quality gate, three browser "phones", a real Chromium service worker, a push service speaking the real protocol, FCM sending against a stand-in for Google, the app's screens against a stand-in for Android, the Android watcher on an emulator). What only real hardware shows (Android's battery saver, a phone off the network, Google's and Apple's push services, a lock screen) is checked by hand before every release, on a deployment with VAPID keys and `FCM_SERVICE_ACCOUNT` set, with an APK built with that Firebase project's `google-services.json`:

| Phone | Plays | Set up |
|---|---|---|
| **Android A** | Mr Rao, with the **Pause Button app** (the watcher) | Install the APK from `/download`, sign in as Mr Rao, Settings › Watch my messages › Connect this phone; the app connects itself, then asks (saying why first) for message reading and background running |
| **Android B** | Arjun (family), in the **Pause Button app** (push through FCM) or in **Chrome** (Web Push) | Sign in as Arjun, link to Mr Rao, turn Notifications on (in the app: "So your family's alerts reach you" → Continue → Android's prompt), "Send me a test alert" |
| **iPhone** (iOS 16.4+) | Meera (family), as an **installed web app** | Safari → Share → Add to Home Screen, open it from the Home Screen, sign in as Meera, link, turn Notifications on |

Keep `/api/ops/push-health` and `/api/ops/sync-health` open on a laptop (operator key): every step below should move their counts as noted.

**Push (Android B and the iPhone)**
1. Phones locked. On Android A paste the "CBI parcel call" sample. Both family phones show "Papa needs you now" on the lock screen within seconds; health: `sent` +2, `shown` +2 (Android B's row has an `fcm:` endpoint when it runs the app).
2. On Android B's lock screen tap **Block payment**: "You blocked it" shows without unlocking; Android A shows "Payment cancelled"; opening the app on the iPhone shows the payment settled ("Papa is protected").
3. Swipe the app away on Android B and kill Safari's web app on the iPhone, paste again: both still ring, and a tap opens the paused payment straight away.
4. Airplane mode on both family phones, paste again, wait 3 minutes, airplane mode off. The push services still accepted both pushes, so health shows them as `silent` while the phones are offline; urgent alerts live 5 minutes, so they arrive if the phones come back within that.
5. Sign out on both family phones (that removes their push setup) and paste again: after 30 s Android A says **"Nobody has seen this yet"**, with a call button.
6. Sign Android B back in with Notifications on, then turn notifications off in Android's settings (for Pause Button when it runs the app, for Chrome when it runs the browser) and paste again: nothing shows; health shows `received` +1 and either `notShown` +1 or `shown` +1 (Android hides it after the app or Chrome showed it, which no web code can see). In the app, the home screen now says "Notifications are off for Pause Button" with "Turn on in Settings".
7. Android B in the app, Android 13 or later: sign in on a fresh install, tap Continue on "So your family's alerts reach you", then **Don't allow** on Android's prompt. Nothing is asked again; the banner offers Settings instead, and turning notifications on there registers the phone without another prompt.

**The watcher (Android A)**
8. Send Android A an SMS from an unknown number with a scam text: it appears in Pause Button and Android B gets the heads-up; the Connect screen's "What we saw today" counts it as sent.
9. Send one from a saved contact: it stays on the phone (counted "from saved contacts, not sent"). Send one from a bank-style header if you can (e.g. a real bank alert): it is checked.
10. Airplane mode on Android A, receive two SMS, wait a minute, airplane mode off: both arrive, oldest first ("waiting for the internet" while offline), once each.
11. Reboot Android A and receive an SMS without opening the app: it arrives. Then `adb shell am kill ai.apty.pausebutton` and receive another: it arrives.
12. Leave Android A locked on battery-optimised for 30 minutes, then receive an SMS. If it does not arrive, the Connect screen's battery step is the fix; note the phone model. Within those 30 minutes the phone should also have reported in by itself: the phone's card on the web app shows "Last sync at …", and it is not marked "Not syncing".
13. In a busy WhatsApp group, at most 4 messages a minute are sent; an SMS from an unknown number still gets through.
14. Remove Android A on the web app (Settings › Watch my messages): the phone shows "Pause Button stopped checking messages". Connect again, then **Disconnect this phone** on the phone: the web app no longer lists it.
15. Turn Android A off for over an hour. After the next server sync (`/api/ops/sync-health`: `quietDevices` +1) Mr Rao's Connect screen shows "Not syncing since …" and Arjun's home says "Papa's phone has not synced for over an hour". Turn it on again: both clear once the phone reports in.

**Record** the date, the three phones' models and OS versions, the build (`git rev-parse --short HEAD`) and any step that failed in the release's PR. Details and the reasoning behind each step: [`docs/push.md`](docs/push.md) (push) and [`android/README.md`](android/README.md) (the watcher).

## Push notifications (alerts when the app is closed)

Every alert the app creates also goes out as a push notification, so the person is told even when the app is in the background, the phone is locked, or the app is closed: **Web Push** to browsers and the iPhone home-screen app, **Firebase Cloud Messaging (FCM)** to the Android app (a WebView has no Web Push). Nothing changes for a phone that has the app open: it still polls every 2 s, buzzes, flashes and opens the alert by itself. The Android side in detail: [`docs/push.md`](docs/push.md), "The Android app: FCM".

**What is pushed, and to whom**

| What happened | Who is told | The notification | A tap opens |
|---|---|---|---|
| A scam was pasted, forwarded or spoken; "Pay anyway"; the live-call guard | every linked family member (urgent) | "Papa needs you now", with **Block payment** and **It's fine** when a payment is paused (F2) | the paused payment, or the message |
| A detected message (Android watcher, simulated inbox) is a scam and "Tell Arjun automatically" is on | family members with the early heads-up (quiet) | "Heads-up: Papa got a scam message" | the message |
| "Ask Arjun" | every linked family member (quiet) | "Papa is asking: is this message safe?" | the message, with the answer buttons |
| A detected message is SCAM or SUSPICIOUS | Mr Rao's own phone, in his language (F5) | "Possible scam from +91 9XXXX XXXXX" | his verdict screen |
| The family blocked or released a paused payment, or answered an "Ask" | Mr Rao's own phone, in his language | "Payment cancelled: Arjun blocked the Rs 80,000 payment" | the payment, or the verdict |

Safe messages are never pushed. A newer notification about the same message replaces the older one in the tray (the quiet heads-up goes when the urgent alert for the forwarded message arrives), and notifications for alerts that were handled in the app, by this person or the other sibling, are cleared.

**Tap to open.** A family notification points at `/open/<alertId>`: a small resolver page (`src/screens/family/open.tsx`, `POST /api/family/alerts/[id]/open`) that marks the alert opened and goes straight to the paused payment (`/family/hold/…`) or the message (`/family/check/…`), never the home screen, also when the alert was already handled (it then shows the outcome). The service worker reuses the window that already shows that part of the app, or opens a new one when the app is closed, so a closed app initialises on the right screen. A signed-out phone keeps the destination through the welcome and sign-in screens (`pending-open.ts`). Someone else's alert goes home. Mr Rao's notifications point straight at `/check/<id>` or `/hold/<id>`. The Android app's notification opens the app on the same `/open/<alertId>` page.

**Phones, people and preferences.** One subscription per browser or app install, stored in `push_subscriptions` (kind `webpush` or `fcm`) and keyed by endpoint; the Android app registers its FCM token through the same `POST /api/push/subscribe` (`{ fcmToken, app }`), kept as endpoint `fcm:<token>`, and `GET /api/push/key` says `{ publicKey, fcm }`. The phone re-sends it on every app start, so it always belongs to the person signed in; signing out removes it (`POST /api/auth/sign-out` carries the endpoint) and the next sign-in registers the phone afresh, without asking for permission again. A subscription made with an older VAPID key is replaced; the browser's `pushsubscriptionchange` re-subscribes and the old endpoint is forgotten; a phone the push service reports gone (404, 410) is deleted. The **Notifications** toggle (family: "So we can reach you fast" and Settings; Mr Rao: Settings) is honoured on the server (`users.alert_notify`), so a second phone of the same person stays quiet too. "Send me a test alert" ignores the toggle on purpose. (The demo panel runs several phones in one browser, which has one subscription: it belongs to whichever frame registered last, so test push on real phones.)

**Reliability.** Each delivery is written to `push_deliveries` (sent; failed, with the push service's status and error; or gone), with the alert and an idempotency key (`alert:<id>`, `check:<id>`, `hold:<id>:<status>`), so the same alert is never pushed twice to one phone and a missing notification can be traced. A temporary failure (429, 5xx, network) is retried once, honouring a short `Retry-After`. A push never fails an alert: the in-app alert, the hold and the event log are written first. The demo panel's event log shows "Push notification sent to N phones" and "Push notification failed for N phones".

**Fallback.** Without push set up on the server (VAPID keys for browsers, `FCM_SERVICE_ACCOUNT` for the app), or when permission is denied, not yet given, or not possible (Safari in the browser), everything else works: the open app still polls, buzzes, flashes and opens alerts. The family home then shows a card saying alerts reach the phone only while the app is open, with the one tap that fixes it; the settings say what is blocking it. A server with only one of the two set up sends only to that kind of phone. In the Android app, the app first says why it asks ("So your family's alerts reach you", Continue / Not now) and only then shows Android's prompt; after "Don't allow" for good it never prompts again, and a banner ("Notifications are off for Pause Button", "Turn on in Settings") opens Android's settings for the app instead (`src/components/native-notifications.tsx`).

**Setup and deployment**
- Environment variables, on every environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (print a pair with `pnpm push:keys`) for browsers and iPhones. Rotating the keys is safe: phones re-subscribe on their next app start.
- Android app: `FCM_SERVICE_ACCOUNT` on the server (the Firebase project's service account JSON, as is or base64-encoded; the server refuses to start with a broken one) and that project's `google-services.json` in the APK build (the `GOOGLE_SERVICES_JSON` repository secret; for a local build, put the file at `android/app/google-services.json`). Messages are data-only, so the app always builds the notification itself: urgent alerts at Android priority HIGH with a 5-minute TTL, the rest NORMAL and an hour. Setup steps: [`docs/deploy.md`](docs/deploy.md), "Android app: push with Firebase". Without Firebase the app still works, and alerts reach it only while it is open.
- Database: migrations `drizzle/0007_push_deliveries.sql`, `drizzle/0009_push_receipts.sql` and `drizzle/0011_old_solo.sql` (`push_subscriptions.kind`, `alerts.repushed_at`) (`pnpm db:migrate`, which the deploy runs; the embedded database migrates itself).
- HTTPS is required (Web Push works on `localhost` and over `pnpm share`, not on a LAN `http://` address).
- iPhone: install to the home screen first (iOS 16.4+), then turn Notifications on; the screen says so.

**Receipts and delivery health.** Each phone's copy carries its delivery id; the service worker, or the Android app, confirms it once the notification is on screen (`POST /api/push/receipt`), or says why it could not show it. A push the service accepted but no phone confirmed within 2 minutes is "silent" and is logged. Operators read per-day sent / failed / gone / shown / silent counts at `GET /api/ops/push-health` (operator key). Mr Rao's verdict and paused-payment screens name anyone the alert has not reached, and say "Nobody has seen this yet" when it reached no one; for an urgent alert that includes someone with no phone set up for push whose app has not picked it up within 30 s. Details, and the real-phone checklist: [`docs/push.md`](docs/push.md).

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
| Temporary delivery errors | One retry on 429/5xx/network; status and error logged in `push_deliveries` | `push.test.ts` "retries once", `push.protocol.test.ts` (real HTTPS answers) |
| Encryption and signing on the wire | `web-push` encrypts for that phone only (RFC 8291) and signs with VAPID (RFC 8292); urgent alerts go out with `Urgency: high`, TTL 5 min | `push.protocol.test.ts` (a push service in the test decrypts and verifies) |
| A real browser receives it | Chromium's service worker shows the alert with Block built in and confirms it; the tap URL opens the payment | e2e "a real service worker shows the alert" |
| Accepted but never shown | No receipt in 2 min: counted as silent, logged; "could not show" is recorded with its reason | `push.test.ts` "receipts, silent phones", `sw.test.ts` "receipts" |
| Nobody can be reached | Every alerted person unreachable: Papa's verdict and hold screens say "Nobody has seen this yet" | `push.test.ts` "who Mr Rao's alert reached", e2e "nobody's phone can be reached" |
| The Android app (FCM) | The service account JWT, one cached token exchange, the data-only message, `UNREGISTERED` forgets the phone, a refused message does not, 503 then 200, 401 signs in afresh, browser and app recipients of one alert | `push.fcm.test.ts` (Google's endpoints mocked) |
| The app's screens | The explanation before Android's prompt, never asking again after "Don't allow", "Turn on in Settings", Connect this phone, each phone's sync state | `e2e/native-app.spec.ts` (a stand-in Capacitor bridge) |
| Nobody confirmed a scam alert | The 30-minute sync job pushes it once more (key `alert:<id>:repush`) | `sync.test.ts` |
| Real phones (the Android app, Chrome, autopush, Apple) | Manual checklist, including the iPhone install-then-enable flow and the app's "Don't allow" flow | [`docs/push.md`](docs/push.md) |

## The sync safety net (every 30 minutes)

The live path comes first: the phone posts a message the moment it arrives, every screen polls every 2 s, push reaches closed apps. Underneath it, two jobs make sure nothing is lost when a phone sleeps, a check fails or a push is never confirmed.

- **On the phone** (`SyncWorker`, WorkManager, every 30 minutes while there is a network, with the app closed too): sends what still waits in the watcher's outbox, fetches the person's watch settings, and reports in with `POST /api/device/status {listenerOn, waiting, sync: true}`. It is scheduled when the phone is connected, after a reboot and on every app start, and cancelled when the phone is disconnected.
- **On the server** (`src/lib/server/sync.ts`, `POST /api/cron/sync`, called every 30 minutes by `.github/workflows/sync.yml` with `Authorization: Bearer <CRON_SECRET>`; `GET` is the same for Vercel Cron). Each run:
  1. **checks again** a watcher message whose check failed or was cut off, through the same exactly-once path, while its text is still kept (24 hours) and up to 3 tries in all; the family is alerted only if it now turns out to be a SCAM. A last try that was cut off is marked "could not check" so Mr Rao can still tap it.
  2. **pushes once more** a scam alert (urgent or heads-up) from the last 24 hours that no phone confirmed and nobody opened or handled, once per alert (`alert:<id>:repush` in the push log).
  3. **flags a phone** that has not reported for 60 minutes (two missed syncs) as **not syncing**: Mr Rao's Connect screen shows "Not syncing since …" on that phone's card, the family home says "Papa's phone has not synced for over an hour: new messages may not be checked", and the household log gets a line. The flag clears when the phone reports in.
  4. records the run in `sync_runs`. `GET /api/ops/sync-health` (operator key) returns the last 20 runs (`rechecked`, `recheckFailed`, `repushed`, `quietDevices`, `error`), `lastRun`, `overdue` (no finished run in 45 minutes) and `intervalMinutes`. Two callers at once are safe: a run holds a lease, and a run abandoned for 15 minutes is taken over.
- **Exactly once.** `POST /api/device/inbox` takes an `Idempotency-Key` header (or `messageId` in the body; 8–100 characters of `[A-Za-z0-9-]`, a UUID fits): the same message posted again, after a timeout or a restart, is not checked twice (200 with `duplicate: true`). When the server's own check fails it answers **202** `{status: "failed"}`: the phone counts the message delivered and does not retry; the sync job does. Posts without a key are not deduplicated.
- **Could not check, tap to retry.** In Mr Rao's inbox such a message reads "We could not check this message · Tap to check it again" (`POST /api/me/inbox/[id]/retry`, owner only, rate-limited like a check). A tap counts as one of the tries. Once the text is gone (24 hours) the answer is 410 and the row says "Message text not kept". After a failed tap the toast says "Still could not check it. Try again in a while, or paste the message to check it."

## The Android app (APK)

`android/` is a **Capacitor** app (`@capacitor/android` 8, `capacitor.config.ts`, Android 8.0+): a WebView that opens the deployed site (`PB_HOST` → `server.url`) full screen, with no address bar and no Chrome around it, so every screen is the web app itself and nothing is bundled twice. What the native side adds (the full table: [`android/README.md`](android/README.md)):

- **Message watcher** (`MessageWatcherService`, `Watcher`): the real version of the simulated inbox (screens M1–M4). After the person agrees on the consent screen and allows notification access, it reads new SMS and WhatsApp notifications and posts them to `POST /api/device/inbox` with an `Idempotency-Key`; the same check runs and the family gets its heads-up for a scam.
- **Connect this phone** happens inside the app: `Settings › Watch my messages › Connect this phone` asks the server for a pairing code (`POST /api/me/devices`, valid 15 minutes) and hands it to the native bridge, which trades it for a token at `/api/device/pair`; nothing to type. The app then asks, saying why first, for message reading (its own consent screen, then Android's notification access list) and for running in the background. In a browser the same screen still shows the code and an "Open the Pause Button app" link (`pausebutton://pair?code=…&host=…`), which only fills the code in; the person taps Connect. Only a hash of the token is stored. Each connected phone's card shows notification access, "Last sync at …", messages waiting, and "Not syncing since …" when the server has not heard from it for an hour.
- **Native bridge** (`PauseButtonNativePlugin`, wrapped in `src/lib/client/native.ts`): `pair`, `watcherStatus`, `openListenerSettings`, `openBatterySettings`, `disconnect`, `notificationStatus`, `requestNotifications`, `openNotificationSettings`, `pushAvailable`. In a browser none of it exists and the web app behaves as before.
- **Push through FCM** (`PauseMessagingService`, `PushAlert`, `Alerts`): the server's data-only messages become notifications with **Block payment** and **It's fine**, Block works from the lock screen, and each one is confirmed to the server. See "Push notifications".
- **SyncWorker** every 30 minutes (see "The sync safety net"), **ShareActivity** (F1, "Pause Button" in the Share sheet), **PairActivity** (a pairing link opened outside the app; it never replaces a connection and warns when the link names another server), **BootReceiver** (rebind and reschedule after a reboot or an update).
- **Built for real phones:** an offline outbox (oldest first, at most 50, at most a day; backoff from 15 s to 15 min; `Retry-After` on 429; 202 counts as delivered; a 401 unpairs and shows "Pause Button stopped checking messages"); no repeats within 10 minutes (salted hashes only, never text); caps for busy chats (4 a minute per chat, 12 a minute in all, 300 a day; a stranger's SMS still gets through); messages from saved contacts and unwatched apps left on the phone; "what we saw today" as counts; "Disconnect this phone" that the web app hears (`/api/device/disconnect`). Tested on the JVM and on an emulator in CI.

Build (JDK 21, Android SDK platform 36, build tools 35 and 36):

```bash
pnpm install
PB_HOST=https://your-deployment pnpm cap:sync    # writes the site into the Android project; Gradle refuses a build that disagrees
cd android && ./gradlew assembleDebug             # → app/build/outputs/apk/debug/app-debug.apk
```

`pnpm android:build` does both. Every build, anywhere, signs with the shared debug key `android/debug.keystore`, so a newer APK installs over an older one (the 0.2 Chrome wrapper included; the person signs in once more the first time). CI builds the debug and release APKs on every push (job "Android APK", artifact `pause-button-debug-apk`); **Publish APK to the website** puts the debug APK at `/pause-button.apk` when the app changes on `main`, and `/download` (with its QR at `/download/qr`) hands it out. Push needs Firebase: the `GOOGLE_SERVICES_JSON` repository secret for the build and `FCM_SERVICE_ACCOUNT` on the server ([`docs/deploy.md`](docs/deploy.md)); without them the app works and alerts reach it only while it is open. The app needs no Digital Asset Links: `/.well-known/assetlinks.json` and `ANDROID_CERT_SHA256` stay only for phones still on the 0.2 wrapper.

**Still native-only, not done:** a full-screen "incoming call" alert that rings through Do Not Disturb; native call detection (the live-call guard asks questions instead); a Play Store listing (needs the notification-access disclosure reviewed and a release key). FCM push and the app's screens are tested against stand-ins for Google and Android only: nobody has yet run them on a real phone with a real Firebase project ([`docs/push.md`](docs/push.md)).

## Deliberate choices and limits in phase 1

- **Calls go through the phone's dialer.** The app never places a call itself: the person confirms in the dialer. Set the demo numbers before a live demo (see "Calls" above).
- **Still open after phase 2:** quiet hours and escalation calls (O3); a full-screen alert that rings through Do Not Disturb (FCM delivers the normal notification now); native call detection (the live-call guard asks questions instead of listening to the call); Play Store listing; a real SMS provider for the sign-in codes (`OTP_PROVIDER=sms` is a placeholder). Hindi and Telugu strings were machine-written and need a native speaker's sign-off: this release's additions are listed in [docs/i18n-review.md](docs/i18n-review.md).
- **Operator pages need a key on a public URL.** Set `OPERATOR_KEY`: every operator page and route (`/demo`, `/tests`, `/campaigns`, `/reports`, their `/api/ops/*` data including `/api/ops/push-health` and `/api/ops/sync-health`, `/api/tests/*`, "Reset demo data", Block / Reject / Unblock on `/reports`) then asks for it once per browser tab. Without the key (on a laptop) they stay open.
- **Demo sign-in is off on a deployment.** "Continue as Mr Rao (demo)" and sign-in codes shown on screen (`OTP_PROVIDER=demo`, the default) let anyone become a demo persona, and no real SMS code exists yet, so on Vercel, Railway, Render, Fly.io, Cloud Run (or with `DEPLOYED=1`) the demo buttons, `POST /api/auth/code` and `POST /api/auth/sign-in` all answer 403 "Sign-in is not open on this site yet" unless `DEMO_SIGNIN=on`; the sign-in screen then says "Sign-in is not open yet". Turn it on only for a deployment that is itself protected (Vercel deployment protection or a password). A laptop or CI keeps it on. With `OTP_PROVIDER=sms`, asking for a code answers 503 "Sign-in codes by SMS are not set up on this site yet." until a provider is wired in.
- **Rate limits.** Checks and calls (which can reach the Anthropic API), the phone watcher's inbox, demo sign-in, asking for a sign-in code and trying one are limited per caller IP and per person, phone or number tried (`src/lib/server/ratelimit.ts`). Asking for a code and trying one count apart, so wrong tries never use up the right to ask for a new code: asking allows 10 per IP and 5 per number in 10 minutes, plus 20 per number a day; trying allows 10 per IP and 10 per number in 10 minutes, plus 30 per number a day; each code also locks after 5 wrong tries (a slip that is not four digits is not a try). Tapping Send again inside the 30 s resend wait answers 429 "Please wait N seconds before asking for a new code." with `Retry-After` and counts against no limit. Over any other limit the API answers 429 with "Too many tries in a short time. Please wait a minute and try again." and a `Retry-After` header, before any AI call. Counters live in the `rate_limits` table (only a hash of the IP is kept); "Reset demo data" clears them. The IP comes from `x-real-ip` / `x-forwarded-for`, which Vercel sets; on another host put a proxy in front that overwrites them.
- **A wrongly blocked domain can be un-blocked** from `/reports` (Unblock, operator key). Its reports end as rejected and it leaves the live blocklist within 15 seconds on every server. Official bank domains still can never be blocked.
- **The rules are a starting point.** The test set is small and team-written, and the training data is synthetic. Treat the numbers as a sanity check, not real-world accuracy.
- **Claude refusals and timeouts fall back to rules only.** No refusal fallback model is configured.
