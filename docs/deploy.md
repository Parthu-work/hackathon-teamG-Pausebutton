# Deploying Pause Button on free credits

## What the app needs from a host

| Need | Why | Where in the code |
|---|---|---|
| Node 22+ running `next build` / `next start` (Next.js 16) | One Next.js app: pages + `/api/*` routes, no separate backend | `package.json`, `next.config.ts` |
| A real Postgres (`DATABASE_URL`) | The embedded PGlite writes to local disk, which hosts wipe on every deploy. Deployments refuse to start without it. | `src/lib/db/index.ts` |
| Run migrations before the new version takes traffic | `pnpm db:migrate` applies `drizzle/*.sql` | `scripts/migrate.ts` |
| HTTPS | Web Push, "Add to Home screen" and the Android app (`PB_HOST`) only work over HTTPS | `src/lib/server/push.ts`, `android/` |
| Secrets: `SESSION_SECRET`, `FINGERPRINT_SECRET`, `OPERATOR_KEY`, `CRON_SECRET`, `VAPID_*` | Sign sessions, key fingerprints, lock `/demo` and `/tests`, unlock the hourly purge, send push | `.env.example` |
| Nothing long-running | No queue, no WebSocket: phones poll every 2–5 s and push is sent inside the request. The one scheduled job, the hourly purge ([retention.md](retention.md)), is an HTTP call from GitHub Actions. Serverless works, and so does a server that sleeps. | `src/screens/rao/shell.tsx`, `src/lib/server/push.ts`, `src/lib/server/retention.ts` |
| Close to India | The users are in India: Singapore is the nearest region on every host | `vercel.json` (`sin1`) |

## Recommendation

**Main deploy: Vercel Hobby + Neon Free.** Both are free with no time limit and need no card, and the repo is already set up for them (`vercel.json`). Every PR gets its own preview URL.

**Railway: use it if the team wants it, with Neon for the database.** Railway's free terms are a one-time $5 trial credit (30 days), then $1 of credit a month. An always-on Next.js server plus a Railway Postgres costs more than $1 a month, so on the free plan Railway lasts about as long as the trial: enough for the hackathon week, not after. Keeping the database on Neon (free, no expiry) and turning on App Sleeping makes the Railway credit last longest. The live deployment runs there: `https://hackathon-teamg-pausebutton-production.up.railway.app`.

**Backup on demo day: `pnpm share`** (Cloudflare quick tunnel from a laptop). Free, HTTPS, no account; the URL changes each run.

| Option | Cost | Limits that matter here | Verdict |
|---|---|---|---|
| **Vercel Hobby + Neon Free** | $0, no expiry | Hobby is for non-commercial use. About 1M function calls a month: one phone left open polls about 1,800 times an hour, so about 550 phone-hours a month. Neon: 0.5 GB storage, 100 compute-hours a month, sleeps after 5 min (first query after that takes about 1 s). | **Best fit.** Already configured. |
| **Railway (+ Neon)** | $5 trial credit for 30 days, then $1/month | Free plan: 0.5 GB RAM, 1 vCPU per service. A Next.js server uses roughly $2–4/month of RAM, so after the trial it needs the $5 Hobby plan. | Good for the hackathon week. **Live here.** |
| **Render Free (+ Neon)** | $0 | The server sleeps after 15 min idle and takes about a minute to wake: a family member who taps a scam alert waits a minute. Render's free Postgres is deleted after 30 days. | Only as a fallback. |
| **Fly.io** | Pay as you go (no free allowance for new accounts) | Needs a card. | Skip. |
| **Laptop + `pnpm share`** | $0 | Only up while the laptop runs; the link changes each time. | Demo-day backup. |

Database alternatives to Neon: Supabase Free (500 MB, pauses after a week without use) or Railway Postgres (uses Railway credit). Neon is the best fit: it doesn't expire, and it's what the README and the Vercel integration already assume.

Free-plan terms change often. These figures were checked in October 2026; confirm on each provider's pricing page before relying on them.

## Before any deploy (once)

1. **Neon:** create a project in **AWS Asia Pacific (Singapore)**. Copy two connection strings:
   - **pooled** (host contains `-pooler`) for Vercel,
   - **direct** for Railway and for migrations.
2. **Secrets:** generate each value once and keep it in a password manager:
   ```bash
   openssl rand -base64 32   # SESSION_SECRET
   openssl rand -base64 32   # FINGERPRINT_SECRET
   openssl rand -base64 32   # OPERATOR_KEY
   openssl rand -base64 32   # CRON_SECRET (also a GitHub repository secret, see "Keeping it live")
   pnpm push:keys            # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
   ```
   Use the same values on every host, so phones that already subscribed keep receiving push.

## Option A: Vercel + Neon (recommended)

1. vercel.com → **Add New → Project** → import `hackathon-teamG-Pausebutton`. Framework: Next.js (detected). Leave the build command alone: `vercel.json` runs `pnpm db:migrate && pnpm build` in `sin1`.
2. **Settings → Environment Variables**, for Production and Preview:
   `DATABASE_URL` (pooled), `SESSION_SECRET`, `FINGERPRINT_SECRET`, `OPERATOR_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<team email>`, `DEMO_RAO_PHONE`, `DEMO_MOM_PHONE`, `DEMO_ARJUN_PHONE`, `DEMO_MEERA_PHONE`, and optionally `ANTHROPIC_API_KEY`, `ANDROID_CERT_SHA256`.
   - Optional: the **Neon integration** (Vercel Marketplace) gives every preview its own database branch, so previews don't share data with production.
3. Deploy. Check `https://<project>.vercel.app/api/health` returns `{"ok":true}`.
4. Set the GitHub repository variable `PB_HOST` to the production URL so the CI-built Android APK points at it.

## Option B: Railway (+ Neon)

Railway has deprecated `railway.json` (Config as Code), and new services ignore it, so these settings live on the service itself (**Settings → Deploy**). Without the pre-deploy command the database has no tables, and without the health check Railway puts a broken build live:

| Setting | Value |
|---|---|
| Pre-deploy command | `pnpm db:migrate` |
| Health check path | `/api/health` (timeout 120 s) |
| Restart policy | On failure, 3 retries |
| Build / start | Railpack defaults: `pnpm build`, `pnpm start` (Next reads Railway's `PORT`) |

`.nvmrc` pins Node 24, the version CI uses.

1. railway.com → **New Project → Deploy from GitHub repo** → pick the repo.
2. Service **Settings**:
   - **Region:** Southeast Asia (Singapore).
   - **Networking → Generate Domain** (gives `https://<name>.up.railway.app`).
   - **Serverless / App Sleeping:** on. The server stops after about 10 min without traffic and wakes on the next request in a few seconds. This stretches the free credit; push is sent inside the request, so nothing is lost while it sleeps.
3. **Variables:** the same list as Vercel, with the **direct** Neon string as `DATABASE_URL`.
   - Using Railway's own Postgres instead: **New → Database → PostgreSQL**, then set `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Simpler, but it uses credit around the clock and doesn't sleep.
4. Set the deploy settings in the table above, deploy, then open `/api/health`: it must answer `{"ok":true}`.
5. Watch **Usage** in the Railway dashboard. When the trial credit runs out, either upgrade to Hobby ($5/month) or move to Option A; the database and secrets stay the same, so phones keep working once the URL changes on them (the Android app lets the person change the host).

## Other hosts

The app checks for `VERCEL`, `RAILWAY_ENVIRONMENT_NAME`, `RENDER`, `FLY_APP_NAME` or `K_SERVICE` (Cloud Run) to know it's deployed, and then refuses to start without `DATABASE_URL`, `SESSION_SECRET` and `FINGERPRINT_SECRET`. On any other host, set `DEPLOYED=1` to get the same checks.

- **Render:** Web Service, build `pnpm install --frozen-lockfile && pnpm build`, pre-deploy `pnpm db:migrate` (or run it in the build command on the free plan), start `pnpm start`, health check `/api/health`, region Singapore.

## Sharing the Android app with a QR code

1. Optional: set the repository variable `PB_HOST` to the deployed URL (GitHub → Settings → Secrets and variables → Actions → Variables). Without it, the workflows use the Railway URL.
2. **Publish APK to the website** builds the app for that address and commits it as `public/pause-button.apk`; the host redeploys, and the workflow waits until the site serves that exact file. It runs by itself whenever `android/` changes on `main`. Run it by hand (Actions → Publish APK to the website → Run workflow) after changing the deployment address.
3. Share `https://<your-site>/download/qr` (print it, or put it on a slide), or the poster in `share/`. Scanning it opens `/download`, which has the download button and install steps.

The QR encodes whatever address the site is opened on, so it needs no setup and stays right if the URL changes.

## Keeping it live

- **Every push to `main` redeploys on Railway.** The pre-deploy step migrates the database and the health check must pass; if either fails, Railway keeps the previous version serving.
- **Uptime check, every hour** (`.github/workflows/uptime.yml`): `scripts/check-site.sh` checks `/api/health` (server and database), `/download` and `/pause-button.apk` from outside, with three tries each so a redeploy is not an outage. On failure it opens one **"The live site is down"** issue (label `site-down`), which notifies everyone watching the repo; later failures comment on it, and the first good check closes it. GitHub also emails the person who last changed the workflow's schedule. Run it any time: Actions → Uptime → Run workflow, or locally `scripts/check-site.sh https://<your-site>`.
  - Hourly keeps it within a private repo's free Actions minutes (every run bills a minute). On a paid plan, tighten the `cron` line.
  - GitHub pauses scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab.
- **Scheduled purge, every hour** (same workflow): `POST /api/cron/purge` deletes message text past 24 hours and activity and push logs past 30 days ([retention.md](retention.md)). Set `CRON_SECRET` on the server and the repository secret `CRON_SECRET` (GitHub → Settings → Secrets and variables → Actions) to the same value; until both are set, the purge step fails and says why, and only checks themselves clear old text. The site-down issue is about the site only: a failed purge turns the run red without opening it.
- **Recommended in Railway:** service → Settings → Source → **Wait for CI**, so a commit that fails CI is never deployed.
- **Credit:** the free Railway credit runs out; watch Usage in the Railway dashboard.

## After deploying: checklist

- [ ] `/api/health` → `{"ok":true}`
- [ ] `/welcome` loads on a phone; "Add to Home screen" offers to install
- [ ] Family phone: the alerts setup screen's "Send me a test alert" arrives as a push notification
- [ ] `/demo` asks for the operator key
- [ ] Android APK built with `PB_HOST` set to this URL
- [ ] `/download` downloads the APK, and `/download/qr` scans to `/download`
- [ ] Actions → Uptime → Run workflow passes
