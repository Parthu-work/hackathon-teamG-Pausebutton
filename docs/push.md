# Push notifications: how we know they work

Alerts reach a family phone in three ways: the open app polls every 2 s, a Web Push
notification wakes a closed app, and Mr Rao can always call. This page says how each
part is tested, what the server records about every push, and how to check real
phones by hand where automation cannot reach.

## What the server records

Every push the server hands to a push service is a row in `push_deliveries`:

| Column | Meaning |
|---|---|
| `status` | `sent` (the push service accepted it), `failed` (refused or unreachable, after one retry for 429/5xx/network), `gone` (404/410: the phone unsubscribed; the subscription is deleted) |
| `received_at` | The phone's service worker got the push and reported back (`POST /api/push/receipt`) |
| `shown_at` | ...and the notification is on screen |
| `display_error` | ...or it got the push but could not show it (for example notifications blocked for the browser in the phone's settings) |

Each phone's copy of a notification carries its own delivery id (`receipt`). The
service worker (`public/sw.js`) sends it back after `showNotification`; the id is the
only credential, so a closed, signed-out app can still confirm.

**Silent:** a `sent` push with no receipt two minutes later. The push service took it,
but the phone never confirmed: it was off or offline past the TTL (5 min for urgent
alerts, 1 h otherwise), battery saving stopped the browser, or the phone still runs a
service worker from before receipts existed (it updates the next time the app opens).
When a phone's last two pushes in 24 h are both silent, the next push to it logs
`[push] a phone of user … confirmed none of its last 2 notifications`.

## Delivery health (operators)

`GET /api/ops/push-health` (needs `x-operator-key` when `OPERATOR_KEY` is set):

```json
{
  "days": [{ "day": "2026-10-10", "sent": 41, "failed": 1, "gone": 2, "received": 39, "shown": 38, "notShown": 1, "silent": 2 }],
  "total": { "sent": 41, "failed": 1, "gone": 2, "received": 39, "shown": 38, "notShown": 1, "silent": 2 },
  "silentAfterMinutes": 2,
  "enabled": true
}
```

Days are India time, newest first, last 14 days. What to look at:
- `failed` rising: the push service is refusing us. Check the VAPID keys and `error` in `push_deliveries`.
- `gone` rising after a deploy: the VAPID keys changed. Phones re-subscribe on their next app start.
- `silent` high compared with `sent`: phones are not getting pushes in time. Ask the
  people concerned to turn off battery optimisation for Chrome (Android) or reopen the
  installed app (iPhone).
- `notShown` above zero: someone has notifications blocked for the browser itself.

## When nobody can be reached

Mr Rao's verdict screen and his paused-payment screen name every family member the
alert has not reached (`unreachableNames`), and say **"Nobody has seen this yet"** when
it reached no one (`nobodyReached`). Someone counts as reached when they opened or
handled the alert, their open app picked it up (`alerts.delivered_at`), or a push to
them was accepted and not reported as unshowable. They count as not reached:
- at once, when every push to them failed or their phone was gone;
- for an urgent alert, when no push got through at all (no phone set up for push,
  Notifications turned off, or push not configured on the server) and their app has
  not picked it up within 30 s.

When an urgent alert goes to someone with no phone set up for push, the demo log says
"No phone set up for alerts: … will see it only while the app is open" at once.

## Automated tests (CI, every PR)

| Layer | What is real | What stands in | Where |
|---|---|---|---|
| Server logic | Database, delivery log, retries, idempotency, receipts, silent detection, health counts, reach rules | The push service (mocked `web-push`) | `src/lib/server/push.test.ts` |
| Protocol | `web-push` encryption (RFC 8291 aes128gcm), VAPID signing (RFC 8292), HTTPS POST (RFC 8030), TTL and Urgency headers; the push service's 201 / 429 + Retry-After / 500 / 410 answers | A push service running in the test: it verifies the VAPID JWT and decrypts with the phone's private key | `src/lib/server/push.protocol.test.ts` |
| Service worker logic | `public/sw.js`: what shows, what a tap opens, lock-screen Block, re-subscribe, receipts | Browser APIs (sandbox stubs) | `src/lib/client/sw.test.ts` |
| Real browser | Chromium's service worker (the full build, run headless: Playwright's default headless shell cannot show notifications) runs `sw.js`, shows the notification (title, tag, `requireInteraction`, Block buttons), posts the receipt the server accepts; the tap URL opens the paused payment. Papa's screens say "Nobody has seen this yet" after 30 s | The push service: DevTools `ServiceWorker.deliverPushMessage` hands the payload over | `e2e/family-phones.spec.ts` (Push in a real browser) |

Not automated, and why: the browser that Playwright ships cannot subscribe to Google's
push service (FCM), and a CI test against Mozilla's or Apple's live service would
depend on a service outside our control. Those paths are the manual matrix below.

## Manual matrix (real phones, before a release)

Use a deployment with VAPID keys set and `/api/ops/push-health` open in another tab.
For each row: sign in as a family member on the phone, turn Notifications on, then
from a second phone sign in as Mr Rao and paste the "CBI parcel call" sample.

| Device and browser | Push service | Steps | Expect |
|---|---|---|---|
| Android, Chrome (or the Android app) | FCM | App open; app in background; phone locked; app swiped away | Urgent notification in every case, stays until handled; **Block payment** works from the lock screen; tap opens the paused payment. Health: `sent` +1, `shown` +1 |
| Android, battery saver on, Chrome "optimised" | FCM | Lock the phone for 10 minutes, then send | Notification may arrive late or not at all. If not, health shows `silent` +1 after 2 min. Papa's screen does not name the person: the push service accepted the push, which counts as reached (only a failed push, a push the phone reported it could not show, or no push at all is named) |
| Android, notifications for Chrome turned off in system settings | FCM | Send | Nothing shows. Health: `received` +1. Depending on the Android and Chrome version the browser reports it as `notShown` (then Papa's screen names the person) or as `shown` (the OS hid it after the browser showed it, which no web code can see) |
| Desktop Chrome or Edge | FCM / WNS | Browser open, tab closed | Notification shows; click opens the app on the payment |
| Desktop Firefox | Mozilla autopush | Browser open, tab closed | As above |
| iPhone, iOS 16.4 or later, Safari | Apple (web.push.apple.com) | Add to Home Screen; open the installed app; turn Notifications on in the app; close it | Notification shows on the lock screen; tap opens the installed app on the payment. In Safari without installing, the app says to install it first |
| Any phone, family member signed out | – | Sign out, then send | No notification to that phone (the subscription was removed); the alert still waits in the app |
| Two people on one phone | – | Arjun signs out, Meera signs in, send to Arjun | Nothing on this phone for Arjun; Meera's alerts arrive |

Record the date, device, OS version and result in the PR that changes push behaviour.

**Not yet verified on a real iPhone.** The install-then-enable flow exists and its
copy is written, but nobody has yet run the iPhone row above on a physical device.
Do that before telling iPhone users to rely on notifications.
