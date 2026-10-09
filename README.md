# Pause Button: phase 1 simulator

A calm second opinion before the money moves. An older person (Mr Rao) checks a worrying message. If it is a scam, the app stops him, pauses the payment and alerts his family (Arjun, Meera). Arjun then blocks or approves the payment from his own phone.

Phase 1 is a **simulator**: a web app that runs on any phone or laptop. It has no real SMS, no real money and no real calls; every message is made up. The screens follow the design file (screens A–L, P, Q and parts of N/O).

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
| `/demo` | Operator panel: both phones side by side, live event log, reset, scam sample, Wi-Fi drop |
| `/tests` | Operator page: the 40-message test set, with misses listed verbatim |

**Sign-in is mock.** Use "Continue as Mr Rao / Mrs Rao / Arjun / Meera (demo)", or any 10-digit number with code `1234`. A new number goes through "Who is this phone for?" and the setup and invite screens. The demo household: Mr Rao ("Papa") and Mrs Rao ("Mummy") are both protected by Arjun and Meera, so each family phone shows a **"Who you protect"** list with one card per parent; Mr Rao's friend Dinesh is invited but waiting. Invite codes: Mr Rao's `PB-4K7Q` (Arjun), `PB-9M2X` (Meera), `PB-7H3D` (Dinesh); Mrs Rao's `PB-2M8R` (Arjun), `PB-5T6W` (Meera). A family member links another person from Settings → "Link another person".

**Two real phones:** run `pnpm dev`, then open the "Network" URL that Next prints (same Wi-Fi) on both phones. Sign one in as Mr Rao and the other as Arjun. Tap Arjun's screen once so it is allowed to play sound.

**Calls:** every "Call Arjun", "Call Papa" and "Call cyber helpline 1930" button opens the phone's dialer with the number filled in; the person still taps the green call button. On a laptop (and in `/demo`) it shows the number instead.
- The numbers come from the trusted people Mr Rao added and from the sign-in number.
- The demo personas use placeholder numbers that may belong to strangers. Before a live demo, put your teammates' real numbers in `.env.local` (`DEMO_RAO_PHONE`, `DEMO_MOM_PHONE`, `DEMO_ARJUN_PHONE`, `DEMO_MEERA_PHONE`) and restart `pnpm dev`.
- Family phones call the parents by nickname ("Papa", "Mummy": `users.nickname`, set for the demo personas); friends see the name.

### Demo script (about 2 minutes)

`/demo` shows three phones: the left one switches between **Mr Rao (Papa)** and **Mrs Rao (Mummy)**, then **Arjun** (son) and **Meera** (daughter). Tap Arjun's and Meera's phones once so they may play sound.

1. Press **Reset demo data**.
2. On Mr Rao's phone, tap **CBI parcel call** → **Check this message**. He sees **STOP**, then the SCAM verdict. Rs 80,000 is paused for 10 minutes.
3. Both family phones buzz, flash and sound (I1). On Arjun's phone: **Open**: he reads **the exact message Papa got**, with the warning signs highlighted → choose advice → **Send advice and call Papa** (opens the dialer) → **Block this payment**.
4. One Block settles it: Mr Rao's phone jumps to **Payment cancelled**, and Meera's alert closes.
5. **Courier fee** gives SUSPICIOUS → **Ask Arjun** → Arjun answers **This is not a scam**. Mr Rao still sees SUSPICIOUS, with "Arjun: not a scam · Waiting for Meera…". When Meera also answers **This is not a scam**, he sees "Arjun and Meera checked it. It is not a scam." If Meera says **It's a scam** instead, it becomes a SCAM.
6. **Run a scam sample** (or "Receive a test scam message" in the simulated inbox). The message arrives by WhatsApp, a banner appears, and both get a quiet heads-up.

On real phones, sign the third phone in with **Continue as Meera (demo)**.

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

**The family's answer decides what Papa sees** (`src/lib/server/answers.ts`). Every trusted person who was alerted or asked answers on their own phone. Blocking a payment counts as "scam"; approving it counts as "not a scam".
- **One "It's a scam" (or one Block) settles it as a SCAM**, straight away, for everyone.
- **"Not a scam" (or Approve) counts only when everyone who was alerted says so.** Until then Mr Rao keeps the automatic verdict and sees each answer and who we are waiting for; a paused payment stays paused.
- When everyone agrees, Mr Rao sees "Arjun and Meera checked it. It is not a scam." (green, with what the app had flagged still listed below), and a paused payment is released (demo).
- Clearing a message the app called SCAM needs a second confirm. While a payment is paused, answers are given on the payment screen (Block / Approve). Someone linked after the alert cannot clear it.

Holds:
- The first decision wins: Block, or Approve (which needs a second confirm).
- After 10 minutes a hold reads as **expired** but the money stays held, and Block still works.
- Expiry is derived from `expires_at`, so no background job is needed.

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
src/app/tests, demo    operator pages (L1, L2)
src/app/api/           route handlers (37)
src/screens/           the screens, one file per area
src/lib/check/         normalise, rules, links, fast gate, Claude reader, pipeline, wording
src/lib/server/        sessions, checks, holds, people/invites, simulated inbox, state, demo reset, test runs
src/lib/db/            Drizzle schema and client
src/data/              examples, 40-message test set, simulated inbox messages, blocklist, gate model
ml/                    fast-gate training (Python) and seeds
e2e/                   three-phone Playwright test
```

## Tests

```bash
pnpm test        # rules, pipeline, model parity, server flow, push notifications, service worker, quality gate
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
- **Deploy:** connect the repo to Vercel. Each PR gets a preview URL, and `main` deploys to production. `vercel.json` runs `pnpm db:migrate && pnpm build` in the Singapore region.
- **Environment variables** for every Vercel environment:
  - `DATABASE_URL` (Neon, same region; the Neon–Vercel integration can create a branch per preview);
  - `SESSION_SECRET`, `FINGERPRINT_SECRET`;
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
3. **A lasting URL (recommended before the demo day):** connect the GitHub repo to Vercel and create a Neon Postgres database. Set these environment variables in Vercel: `DATABASE_URL`, `SESSION_SECRET`, `FINGERPRINT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (from `pnpm push:keys`), the `DEMO_*_PHONE` numbers and optionally `ANTHROPIC_API_KEY`. Every push to `main` deploys; every PR gets a preview link.

**Each user on their own phone:**
- Mr Rao's phone: sign in (any 10-digit number, code `1234`), choose "I want protection", add trusted people with their real numbers, share the codes.
- Each trusted person: sign in with the number Mr Rao entered, choose "I protect someone", enter the code, turn on **Notifications** on the "So we can reach you fast" screen (the phone asks for permission), tap **Send me a test alert**: it should ring *and* appear in the notification bar.
- iPhones: push only works once the app is installed (Share → Add to Home Screen); the screen says so.

**Alerts when the app is closed (Web Push)** reach family phones, and Mr Rao's phone when family answers or sends advice, even when the app is closed, in the background or the phone is locked. A tap opens the exact payment or message (`/open?…`, which also works signed out: sign in, then land on it). Pushes are deduplicated, retried on temporary failures, logged in `push_notifications`, follow sign-in and sign-out on a phone, and respect each person's Notifications setting; when a phone cannot be reached the sender is told to call. Without VAPID keys the app simply skips push. Details, setup and the test matrix: [docs/push-notifications.md](docs/push-notifications.md).

## The Android app (APK)

`android/` is a small native app, built with Gradle (see `android/README.md`):

- It opens the web app **full screen inside Chrome** (a Trusted Web Activity), so push notifications, the dialer, vibration and every screen work unchanged, with no Firebase and no WebView.
- Its **message watcher** is the real version of the simulated inbox (screens M1–M4): after the person allows notification access, it reads new SMS and WhatsApp notifications and posts them to `POST /api/device/inbox`; the same check runs and the family gets its heads-up.
- **Connect this phone** (`Settings › Watch my messages`) shows a 15-minute code; the app trades it for a token (`/api/device/pair`) and reports whether notification access is on (`/api/device/status`). Only a hash of the token is stored.

Build: `cd android && ./gradlew assembleDebug -PPB_HOST=https://your-deployment` → `app/build/outputs/apk/debug/app-debug.apk` (about 5 MB). CI builds it on every push ("Android APK (debug)" artifact). Full-screen mode needs `/.well-known/assetlinks.json`, served from `ANDROID_CERT_SHA256`. The user manual is published as an artifact (link in the project chat) and summarised in `android/README.md`.

**Still native-only, not done:** FCM push with a full-screen "incoming call" alert that rings through Do Not Disturb (Web Push covers the normal case), and a Play Store listing (needs the notification-access disclosure and a release key).

## Deliberate choices and limits in phase 1

- **Calls go through the phone's dialer.** The app never places a call itself: the person confirms in the dialer. Set the demo numbers before a live demo (see "Calls" above).
- **Phase 2 or later:**
  - the Android notification reader (screens M1–M4);
  - quiet hours and escalation calls (O3), and the weekly summary (O4);
  - Hindi and Telugu screens (K3). The language chips say "Phase 2". The checker already reads Hindi, Telugu and Hinglish.
- **Operator pages are open.** `/demo`, `/tests` and "Reset demo data" have no login. Put them behind a password before a public deploy.
- **The rules are a starting point.** The test set is small and team-written, and the training data is synthetic. Treat the numbers as a sanity check, not real-world accuracy.
- **Claude refusals and timeouts fall back to rules only.** No refusal fallback model is configured.
