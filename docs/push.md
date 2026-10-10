# Push notifications: how we know they work

Alerts reach a family phone in three ways: the open app polls every 2 s, a push
notification wakes a closed app (Web Push in a browser or the iPhone home-screen app,
FCM in the Android app), and Mr Rao can always call. This page says how each part is
tested, what the server records about every push, and how to check real phones by
hand where automation cannot reach.

## What the server records

Every push the server hands to a push service is a row in `push_deliveries`:

| Column | Meaning |
|---|---|
| `status` | `sent` (the push service accepted it), `failed` (refused or unreachable, after one retry for 429/5xx/network), `gone` (404/410, or FCM's `UNREGISTERED`: the phone unsubscribed or the app was removed; the subscription is deleted) |
| `endpoint` | The browser's push endpoint, or `fcm:<token>` for the Android app |
| `received_at` | The phone's service worker (or the Android app) got the push and reported back (`POST /api/push/receipt`) |
| `shown_at` | ...and the notification is on screen |
| `display_error` | ...or it got the push but could not show it (for example notifications blocked for the browser, or for the app, in the phone's settings) |

Each phone's copy of a notification carries its own delivery id (`receipt`). The
service worker (`public/sw.js`) sends it back after `showNotification`, and the Android
app does the same once it has shown the notification; the id is the only credential,
so a closed, signed-out app can still confirm.

**Silent:** a `sent` push with no receipt two minutes later. The push service took it,
but the phone never confirmed: it was off or offline past the TTL (5 min for urgent
alerts, 1 h otherwise), battery saving stopped the browser or the app, or the phone
still runs a service worker from before receipts existed (it updates the next time the
app opens). When a phone's last two pushes in 24 h are both silent, the next push to it
logs a `push_silent_phone` warning (`userId`, `unconfirmed`, `pushService`: the push
service's host, or `fcm`; one JSON line, see `src/lib/server/log.ts`).

## The Android app: FCM

The Android app (Capacitor, `android/`) shows the same site, but a WebView has no Web
Push. It gets alerts while closed through Firebase Cloud Messaging (FCM) instead:

1. **Asking.** Before Android's notification prompt the app says why ("So your family's
   alerts reach you" / "So you hear the moment Papa needs you", Continue or Not now).
   After "Don't allow" for good it never prompts again: a banner says "Notifications are
   off for Pause Button" and "Turn on in Settings" opens Android's settings for the app
   (`src/components/native-notifications.tsx`).
2. **Registering.** Once allowed, the web code asks the push plugin for the phone's FCM
   token and sends `POST /api/push/subscribe { fcmToken, app }`. The server keeps it as a
   `push_subscriptions` row of kind `fcm`, endpoint `fcm:<token>`, no keys. It is sent
   again on every app start (and when the person turns notifications on in Android's
   settings and comes back), so the phone always belongs to whoever is signed in.
   Sign-out and Notifications off forget `fcm:<token>` and delete the token on the phone.
3. **Sending.** `pushToUsers` sends each alert to every phone of the person: Web Push
   to browsers, FCM HTTP v1 (`projects/<project_id>/messages:send`) to the app. Same
   idempotency key, same `push_deliveries` rows, same rules for who gets what. A server
   with only one of the two set up sends only to that kind of phone; the other rows stay
   until it is set up.
4. **Showing.** The message is data only (no `notification` block), so the app always
   builds the notification itself. Every value is a string: `title`, `body`, `url`,
   `tag`, `urgent` (`"1"`/`"0"`), `kind`, `alertId`, `checkId`, `holdId`, `who`, `at`,
   `receipt`, and `actions` (JSON of the Block / It's fine buttons). Urgent alerts go at
   Android priority `HIGH` with a 5-minute TTL (`300s`), the rest `NORMAL` and `3600s`.
   The app shows urgent alerts on its high-importance channel with vibration, posts the
   receipt itself, opens `/open/<alertId>` on a tap, and blocks the payment from the
   notification's Block button.

| FCM answers | Delivery row |
|---|---|
| 200 | `sent` |
| 404, `UNREGISTERED`, or `INVALID_ARGUMENT` about the token | `gone`, and the subscription is deleted |
| 429, 5xx, no answer | one retry (after Retry-After, up to 5 s), then `failed` |
| 401 | the cached access token is dropped and the push retried once |
| any other error (including `INVALID_ARGUMENT` about the message) | `failed`; the phone is kept |
| Google refuses the service account (`oauth 400: invalid_grant`, …) | `failed`, not retried; the phone is kept. Check `FCM_SERVICE_ACCOUNT` |

**What to configure.**
- Server: `FCM_SERVICE_ACCOUNT`, the Firebase project's service account key (Firebase
  console › Project settings › Service accounts › Generate new private key): the whole
  JSON file, as is or base64-encoded. The server signs a JWT with its private key
  (RS256), exchanges it at Google's token endpoint for an access token (scope
  `firebase.messaging`) and keeps it until five minutes before it expires. The server
  refuses to start with a value that is not such a file. `pushEnabled()` is true with
  VAPID keys or FCM; `GET /api/push/key` says `{ publicKey, fcm }`.
- App: `google-services.json` from the same Firebase project, at build time. Without
  it the app works, but cannot get a token: turning Notifications on says push is not
  set up, and alerts reach that phone only while the app is open.

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

Days are India time, newest first, last 14 days. Browsers and the Android app are
counted together; `endpoint` in `push_deliveries` tells them apart (`fcm:` for the app).
What to look at:
- `failed` rising: the push service is refusing us. Check the VAPID keys (or, for
  `fcm:` rows, `FCM_SERVICE_ACCOUNT`: an `oauth …` error means Google refused it) and
  `error` in `push_deliveries`.
- `gone` rising after a deploy: the VAPID keys changed (or the app moved to another
  Firebase project). Phones re-register on their next app start.
- `silent` high compared with `sent`: phones are not getting pushes in time. Ask the
  people concerned to turn off battery optimisation for Chrome or for the Pause Button
  app (Android), or reopen the installed app (iPhone).
- `notShown` above zero: someone has notifications blocked for the browser or the app itself.

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
| FCM sending | Database, the service account JWT (signed, then verified with the public key), one token exchange shared and cached, the data-only message (string values, priority and TTL, receipt = delivery id), `UNREGISTERED` and token-`INVALID_ARGUMENT` forget the phone, a refused message does not, 503 then 200, 401 signs in afresh, a refused service account fails without a retry, app phones left alone while FCM is not set up, browser and app recipients of one alert, idempotency, `POST /api/push/subscribe { fcmToken }` | Google's token endpoint and FCM (mocked `fetch`); Web Push (mocked `web-push`) | `src/lib/server/push.fcm.test.ts` |
| The app's web half | The screens and the server in Chromium: the explanation before Android's prompt, never asking again after "Don't allow", "Turn on in Settings", Connect this phone (pairing with a real code), message reading and background running after saying why; in a plain browser, the code and `pausebutton://pair` link, and each phone card's sync state (not syncing, last sync, messages waiting) | Capacitor's native bridge and Android (a stand-in `window.androidBridge` with the PauseButtonNative plugin); the device list's sync fields in the last test | `e2e/native-app.spec.ts` |

Not automated, and why: the browser that Playwright ships cannot subscribe to Google's
push service, no test here runs the Android app itself (its notification, its receipt,
Block from the notification), and a CI test against FCM's, Mozilla's or Apple's live
service would depend on a service outside our control. Those paths are the manual
matrix below.

## Manual matrix (real phones, before a release)

Use a deployment with VAPID keys and `FCM_SERVICE_ACCOUNT` set, an app built with that
Firebase project's `google-services.json`, and `/api/ops/push-health` open in another tab.
For each row: sign in as a family member on the phone, turn Notifications on, then
from a second phone sign in as Mr Rao and paste the "CBI parcel call" sample.

| Device and browser | Push service | Steps | Expect |
|---|---|---|---|
| Android, the Pause Button app | FCM (app) | App open; app in background; phone locked; app swiped away | Urgent notification in every case, with vibration, stays until handled; **Block payment** works from the lock screen and then shows "You blocked it"; tap opens the paused payment. Health: `sent` +1, `shown` +1; the row's endpoint starts with `fcm:` |
| Android 13 or later, the app, first start | – | Sign in; the app explains, tap Continue, then "Don't allow" on Android's prompt | Nothing more is asked. "Notifications are off for Pause Button" shows on the home screen and in Settings; "Turn on in Settings" opens Android's notification settings for the app; turning them on there and going back registers the phone without another prompt (next alert arrives) |
| Android, the app, battery optimisation on | FCM (app) | Lock the phone for 10 minutes, then send | Urgent alerts (high priority) still arrive; if one does not, health shows `silent` +1 after 2 min |
| Android, the app reinstalled (or its data cleared) | FCM (app) | Send before opening the app again | FCM answers `UNREGISTERED`: health `gone` +1 and the old token is deleted; after the app is opened and signed in, the next alert arrives |
| Android, Chrome | FCM | App open; app in background; phone locked; app swiped away | Urgent notification in every case, stays until handled; **Block payment** works from the lock screen; tap opens the paused payment. Health: `sent` +1, `shown` +1 |
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

**Not yet verified with the Android app on a real phone.** FCM sending is tested
against a stand-in for Google, and the app's screens against a stand-in for Android;
nobody has yet run the four "the app" rows above with a real Firebase project. Do that
before telling Android users the app alerts them when it is closed.
