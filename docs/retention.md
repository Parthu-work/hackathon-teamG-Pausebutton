# What we keep, and for how long

This is the data retention policy. The privacy screen (P3, "What we keep",
`src/screens/rao/history.tsx`, wording in `src/lib/i18n/*` under `privacy`)
says the same in plain words: when one changes, change the other.

Two rules come first and never bend:
- **The text of a safe message is never stored.** The one exception is the
  person's own choice: "Ask Arjun anyway" on a safe message shares its text
  with the family, and from then on it is treated like a scam message's text
  (24 hours). See "Decisions for the team" below.
- **The text of a scam or suspicious message is kept for at most 24 hours**,
  so that the family members who were alerted can read exactly what arrived.
- **A message the watcher sent us that we could not check yet keeps its text
  for at most 24 hours**, only so that it can be checked again. Nobody reads
  it, not even Mr Rao on his inbox screen. Once it is checked the rules above apply.

## In the database

| What | What it holds | Why | How long | What deletes it | Who can read it |
|---|---|---|---|---|---|
| Account (`users`) | Name, nickname, phone number, language, text size, watch and alert settings | Sign-in, the right screens | Until the account is deleted | Delete my account | The person; the family they are linked to sees name and number |
| Trusted people (`links`) | The name, relation and phone number Mr Rao typed for each person, the invite code | Who gets alerts | Until he removes the person or deletes his account | Remove person; Delete my account. When the trusted person deletes their account, the row goes back to "waiting" with a new code | Mr Rao and the linked person |
| Check record (`checks`) | Fingerprint (a keyed one-way code), verdict, the warning phrases found, the link and its domain, amount and payee, sender's name or number (detected and forwarded messages), title, source, time, the family's answer | History, holds, the family's decision | Until the history or the account is deleted | Delete my history; Delete my account | The person; family members who were alerted see it |
| Message text of a scam or suspicious check (`checks.message_text`) | The full text | So alerted family read exactly what arrived (I2, J2, O2) | 24 hours from the check | Unreadable after 24 hours (`sharedText`); deleted by the next purge (hourly, and before every check). Also Delete my history / account | The person, and the family members who were alerted or asked about it |
| Message text of a safe check | Nothing | – | Never stored | – | – |
| Watcher messages (`sim_messages`, from the Android app) | Sender, channel, whether it was a saved contact, the link to its check, the phone's own id for the message (so a repeated post is not checked twice), its status (being checked, checked, could not check) with the error code and how often it was tried. No text once it is checked | The inbox list, the "Possible scam" banner, "We could not check this message" | As long as the check | Delete my history; Delete my account | The person |
| Text of a watcher message we could not check yet (`sim_messages.text` while the status is "received" or "failed") | The full text | So the sync job (every 30 minutes, up to 3 tries) or Mr Rao's tap can check it again | Until it is checked (cleared in the same transaction that stores the check), **24 hours** at most; then the message stays "could not check" with no text, and nobody tries again | The check itself; the purge (hourly, and before every check); Delete my history / account | The server only. Never shown, not even to the person |
| Messages that are not checked (an app he is not watching, or a saved contact while "Only unknown senders" is on) | Nothing, apart from a "not checked" line in the activity log | – | Never stored | – | – |
| Demo inbox messages (`sim_messages` with `synthetic`) | The text of made-up library messages (`src/data/sim-messages.json`) | So the demo inbox reads like a phone | Until Delete my history, Delete my account or Reset demo | Same | The person |
| Payment holds (`holds`) | Payee, amount, status, who decided, when | The paused payment | Until the history or account is deleted. A payment still on hold stays (with its message and timeline) until it is decided, so the family's Block still reaches it | Delete my history; Delete my account (refused while a payment is on hold) | The person and their family |
| Alerts, answers, advice (`alerts`, `answers`, `advice`) | Who was alerted and when it was delivered, opened, handled and (once, when no phone confirmed it) pushed again; each answer; advice text | The family's decision | With the check. A family member's own answers and advice go when they delete their account | Delete my history; Delete my account (either side) | The person and their family |
| Activity log (`events`) | Lines such as "Verdict SCAM · WhatsApp from +91 …", "Urgent alert sent to Arjun", "Arjun sent advice: …" | The live log (L2) and the payment timeline (I4) | **30 days** | The purge; Delete my history; Delete my account (his own household) | The person and their family |
| Phones for notifications (`push_subscriptions`) | Push endpoint, its keys, the browser name | Send notifications | Until sign-out, Notifications off on that phone, or the account is deleted | Same | The server only |
| Push delivery log (`push_deliveries`) | Endpoint, status, error, time | Delivery health (`/api/ops/push-health`) | **30 days** | The purge; Delete my account | Operators |
| Connected Android phones (`devices`) | Device name, a hash of its token, last seen, last 30-minute sync, how many messages waited in its outbox then, message count, since when it has not reported ("not syncing") | The watcher; the family's "has not synced for over an hour" line | Until the phone is disconnected or the account is deleted | Disconnect; Delete my account | The person; the family sees only whether it is syncing |
| Sync job runs (`sync_runs`) | When each 30-minute run started and finished, how many messages it checked again, alerts it pushed again, phones it found quiet, and the error codes of a step that failed. No personal data | Operators (`/api/ops/sync-health`) | **30 days** | The purge | Operators |
| Sign-in codes (`otp_codes`) | The phone number, a keyed hash of the 4-digit code (never the code), expiry, wrong tries, when it was used and when the demo showed it | Sign-in | **24 hours** | The purge | The server only |
| Campaign sightings (`sightings`) | Fingerprint, a household key, scam type, title, link domain, time | "N other families got this" (F3) and the area list (F12) | Kept. Delete my history and Delete my account replace the household key with a random one, so the sightings still count but no longer lead back to the person | – | Counts are shown to everyone; rows to operators |
| Reported domains (`reported_domains`) | Domain, reporter's name, review status | The family blocklist (F9) | Kept. When the reporter deletes their account their name is removed | – | Operators |

## Outside the database

| Where | What | How long |
|---|---|---|
| Claude (Anthropic) | The text of a message that needs a closer look (suspicious), when `ANTHROPIC_API_KEY` is set | Anthropic's API data retention under its commercial terms. **Confirm the current period before release** and say it on the privacy screen if it changes the promise |
| Family phones | A notification shows who it is about, the amount and up to two warning phrases | Until the person clears it. It cannot be recalled after a check or an account is deleted |
| Push services (Google, Mozilla, Apple) | The notification, end-to-end encrypted: the push service cannot read it | Held at most for the TTL (5 minutes for urgent alerts, 1 hour otherwise) when the phone is offline |
| The phone that checked a message | The pasted text, in that browser tab's `sessionStorage`, so "Why we think so" can highlight it | Until the tab is closed. Delete my history and Delete my account clear it on that phone |
| The Android app | A message it could not post yet (no network, server down), in app-private storage that is excluded from backups | Until it is posted (at once, after its backoff, or by the phone's 30-minute sync). At most 50 wait, the oldest dropped beyond that, and none longer than a day. All are deleted when the phone is disconnected on the phone or removed on the web app |
| Server logs (Railway) | Unexpected errors: a reference, the method, the path and the error's name, code and first line. Watcher and sync lines (`inbox_*`, `sync_*`): ids, verdicts, counts, durations and error codes | The host's log retention for the plan. Log lines must never carry message text or a sender (`src/lib/server/log.ts`; `sync.test.ts` checks the watcher's) |
| Database backups (Railway or Neon) | A copy of the database, deleted rows included | The host's backup or point-in-time window. After restoring a backup, run the purge at once |

## The schedule

- **Every hour** the Uptime workflow (`.github/workflows/uptime.yml`) calls
  `POST /api/cron/purge` with `Authorization: Bearer <CRON_SECRET>`
  (`src/app/api/cron/purge/route.ts`, `src/lib/server/retention.ts`). It
  deletes message text older than 24 hours, text left on real inbox rows
  that are checked or skipped, the text of a message we could not check once
  it is 24 hours old, sign-in codes older than 24 hours, and activity, push
  and sync-run log rows older than 30 days. The answer says how many rows each
  step touched; the run's summary shows it.
- **Every 30 minutes** the Sync workflow (`.github/workflows/sync.yml`) calls
  `POST /api/cron/sync` with the same header (`src/lib/server/sync.ts`). It
  checks again a message whose check failed (its text is then cleared like
  any other), pushes an unconfirmed scam alert once more and flags a phone
  that stopped reporting. It keeps nothing new beyond its `sync_runs` row.
- **Before every check** the server also deletes text older than 24 hours
  (`purgeSharedText` in `storeCheck`), so a busy server never waits for the job.
- **Between runs** the read gates hide text older than 24 hours
  (`sharedText`), so nobody can read it even if a run is late or missed.
- Set `CRON_SECRET` on the server and as a repository secret with the same
  value. Without it both endpoints refuse to run and the workflows fail,
  saying so. On Vercel Pro, a Vercel Cron for `/api/cron/purge` and
  `/api/cron/sync` works too (it sends the same header).

## Deleting

**Delete my history** (P3, `DELETE /api/me/checks`): his checks with their
holds, alerts, answers and advice; his inbox; his household's activity log;
the link between him and his sightings; and the message texts kept on that
phone. A payment still on hold stays, with its message and timeline, until it
is decided.

**Delete my account** (P3 for Mr Rao, J4 for a family member; `DELETE
/api/me/account`, `DELETE /api/family/account`; `src/lib/server/account.ts`):
- Refused while a payment is on hold in his household, or in a household the
  family member protects: the family's Block must still reach it.
- Refused for the shared demo personas.
- In one transaction: everything in "Delete my history", plus the account,
  its settings, phones (watcher and notifications) and push log. Links where
  the person is the trusted one go back to "waiting" with a new code, and
  that household's log says they left. Domains they reported stay blocked,
  without their name.
- What stays: lines in other households' activity logs that name them (for up
  to 30 days), and notifications already shown on phones.
- Sign-in sessions are signed cookies; the account's cookies on that phone
  are cleared, and a cookie anywhere else stops working because the account
  is gone.

## Decisions for the team

- **"Ask anyway" on a safe message stores its text** (`askFamily`,
  `src/lib/server/checks.ts`; covered by `flow.test.ts`). It is the person's
  explicit choice and it follows the 24-hour rule, but it is an exception to
  "safe text is never stored". The privacy screen says so. To remove the
  exception, share the text only inside the notification and drop it from
  the database; that changes a tested behaviour, so it is a team decision.
- **An error's first line still reaches the logs.** `route()`
  (`src/lib/server/http.ts`) logs an unexpected error through
  `src/lib/server/log.ts`, which drops a failed query's bound values and a
  database error's detail but keeps the first line of the message. Code that
  puts message text into an error message would leak it; the watcher path
  and the sync job log only error codes for that reason.
- **The family app (`/family`) is English only**: its wording, including the
  account deletion sheet, is not in `src/lib/i18n` yet.
- **Native-speaker sign-off** of the Hindi and Telugu privacy wording is a
  release gate, like the rest of those strings.
