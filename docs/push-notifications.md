# Push notifications

Family phones (Arjun, Meera) and the protected person's phone (Mr Rao) get alerts **when the app is closed, in the background, or the phone is locked**. Tapping one opens the exact payment or message it is about.

It is standard **Web Push** (VAPID). The same code works in Android Chrome, in the Android app (a Trusted Web Activity), in desktop browsers, and on iPhone once the app is on the Home Screen. There is no Firebase project and no extra service.

## How it works

```
alert created ──► sendAlerts / settle / addAdvice            (src/lib/server/checks.ts, answers.ts, holds.ts, notify.ts)
                    │  one push per person, dedupe key "alert:<id>", "answer:<checkId>", "advice:<id>"
                    ▼
               pushToUsers                                     (src/lib/server/push.ts)
                    │  skips people with Notifications off (users.alert_notify)
                    │  sends to every registered phone of the person, retries a passing failure twice at once
                    │  logs the result in push_notifications + the event log ("Push not delivered to Meera: …")
                    ▼
        push service (Google / Mozilla / Apple)
                    ▼
               public/sw.js  "push"
                    │  app on screen?  → no system notification (the app already rings); tells the page to refresh now
                    │  otherwise       → system notification, tag per check (a heads-up is replaced by the urgent alert)
                    ▼
               tap  "notificationclick"
                    │  reuses an open window of the app, or starts it
                    ▼
               GET /open?alert=<id>  |  /open?app=rao&to=/hold/<id>          (src/app/open/route.ts, src/lib/server/open.ts)
                    │  signed out → /welcome?next=… → sign in → back to /open
                    │  marks the alert opened, then → /family/hold/<id> or /family/check/<id>
                    ▼
               the payment / message screen (works even if someone else already decided it)
```

### What each person gets

| Event | Who | Opens |
|---|---|---|
| Scam pasted (urgent, with or without a paused payment) | every linked family member | `/family/hold/<id>` or `/family/check/<id>` |
| Scam arrives in the watched inbox (heads-up) | family with "Early heads-up" on | `/family/check/<id>` |
| "Ask Arjun" | every linked family member | `/family/check/<id>` |
| "Pay anyway" on a scam (urgent) | every linked family member | `/family/hold/<id>` |
| Family's answer is final (blocked, released, scam, not a scam) | the protected person | `/hold/<id>` or `/check/<id>` |
| Family sends advice | the protected person | `/hold/<id>` or `/check/<id>` |

### Reliability

- **Idempotent.** `push_notifications` has a unique `(user_id, dedupe_key)`. The same alert is pushed at most once per person, even if a request is retried. On the phone, one notification per check (`tag`) replaces the earlier one instead of stacking.
- **Transient failures** (network error, timeout, 429, 5xx). The send is retried twice at once (250 ms, then 1 s, honouring `Retry-After` up to 2 s). If it still fails, the row stays `retrying` and is sent again from the household's own polling (`retryDuePushes`, called by `/api/me/state` every 2 s), after 15 s, 60 s and 180 s. Claiming a row is a conditional update, so two polls never send it twice. After 30 minutes an alert is stale and marked `failed`.
- **Dead phones.** A 404 or 410 from the push service deletes the subscription. Three permanent failures in a row (e.g. 403 after the VAPID keys changed) delete it too. `failure_count`, `last_error` and `last_error_at` are on `push_subscriptions`.
- **Statuses** in `push_notifications.status`: `sending`, `sent`, `retrying`, `failed`, `no_device` (nobody registered a phone), `disabled` (Notifications turned off). `attempts`, `devices`, `delivered` and `last_error` show what happened.
- A push never fails the alert. The in-app alert (polling every 2 s) always happens too.

### Fallbacks when push cannot reach someone

- **Recipient's phone.** While the app is open it still rings, flashes and opens the alert by polling, exactly as before. The family home shows **"Alerts only ring while this app is open"** with the fix: turn on, allow in phone settings, or add to Home Screen on iPhone.
- **Sender's phone.** If an alerted person has no registered phone, has notifications off, or the push failed, and they have not opened the alert yet, Mr Rao's STOP and verdict screens say **"Meera may not see it quickly. Call them."** The demo event log says why: `Push not delivered to Meera: no phone registered for notifications…`.

### Devices, sign-in and sign-out

- One subscription per browser or app install, stored in `push_subscriptions` and keyed by its endpoint. A person can have several phones; all of them ring.
- **Sign-in on a phone someone else used.** Registering the endpoint moves it to the new person (`saveSubscription` upserts on the endpoint), so the previous person's alerts stop reaching that lock screen.
- **Sign-out** sends this phone's endpoint and the server deletes it (`/api/auth/sign-out`). No alerts arrive until someone signs in again.
- **Endpoint rotation.** The service worker's `pushsubscriptionchange` re-registers with the old endpoint, so it works without the app being opened or a session cookie.
- **Turning Notifications off** unsubscribes this phone and sets `alert_notify = false`. The server then skips every phone of that person.
- The demo panel's phone frames share one browser: they never register push, so they cannot move the subscription between personas.

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | server (Vercel: every environment) | Generate once with `pnpm push:keys`. Keep the private key secret. Without them push is off and the app works as before (alerts by polling while open). Changing them invalidates every phone's subscription: they are forgotten after their first failures and phones re-register on next open. |
| `VAPID_SUBJECT` | server | `mailto:` address the push services can contact. |

**Database:** run migration `drizzle/0006_push_delivery.sql`. It is additive: a new table and three nullable or defaulted columns. Vercel already runs `pnpm db:migrate` before `pnpm build`. Locally the embedded database migrates itself.

**HTTPS is required** for service workers and push (except `localhost`). Use the Vercel deployment, or `pnpm share` (Cloudflare tunnel) for a quick test on real phones.

### Platforms

| Platform | Setup |
|---|---|
| Android Chrome | Nothing. Allow notifications when asked. |
| Android app (TWA) | Built in: `DelegationService` in `android/app/src/main/AndroidManifest.xml` shows pushes as Pause Button notifications and opens the app on tap. Full-screen mode needs `ANDROID_CERT_SHA256` (assetlinks). Ask people to turn off battery optimisation (the Connect screen helps) so alerts are not delayed. |
| iPhone / iPad (iOS 16.4+) | Push works only for the app added to the Home Screen (Share › Add to Home Screen), then turn on Notifications inside it. The app says so. |
| Desktop Chrome, Edge, Firefox | Nothing. |

Operating-system limits still apply. A denied permission, Do Not Disturb, Focus modes, and aggressive battery savers on some Android phones can delay or hide notifications. The in-app fallbacks above cover them.

## Testing

Automated:

```bash
pnpm test     # src/lib/server/push.test.ts (server), src/lib/client/sw.test.ts (service worker)
pnpm build && pnpm e2e   # "notification tap: …" tests in e2e/family-phones.spec.ts
```

| Scenario | Covered by |
|---|---|
| Recipient is using the app | `sw.test.ts` "does not duplicate the in-app alarm while the family app is on screen" (in-app alarm, no duplicate) |
| Recipient is in another app, phone locked, app in background | `sw.test.ts` "shows a loud notification when the app is closed, the phone locked, or another app in front" (page hidden) |
| App closed and must start | `sw.test.ts` "app closed: starts it on the alert"; e2e "opens the payment even when the app was closed and signed out" |
| Tap reaches the right alert | e2e "notification tap: …"; `push.test.ts` "a tapped notification opens the payment or the message…" |
| Several alerts in a row | `push.test.ts` "several alerts in a row…"; e2e "a second alert rings but does not pull Arjun off the payment he opened" |
| Token changes or becomes invalid | `push.test.ts` "follows the browser to a new endpoint", "forgets a phone the push service says is gone", "forgets a phone after repeated permanent failures"; `sw.test.ts` "subscription rotation" |
| Temporary push service failure | `push.test.ts` "retries a transient failure at once", "keeps retrying a push service outage…", "gives up on a stale alert" |
| Permission denied / Notifications off | `push.test.ts` "respects the person's Notifications setting", "tells Papa when his family cannot be reached"; family home warning |
| Sender and recipient on different phones | `push.test.ts` "sender and recipients on different phones: each gets only their own" |
| Recipient logs out, another user logs in | `push.test.ts` "signing out stops this phone's alerts; the next person to sign in gets the phone"; e2e "someone else signed in on the phone never sees that alert" |
| Duplicate sends | `push.test.ts` "is idempotent: one dedupe key is sent once per person" |

Manual check on real phones (needs HTTPS and VAPID keys):

1. Phone A: sign in as Arjun. In Settings, turn on **Notifications** and allow. **Send me a test alert** should appear in the notification bar.
2. Phone B: sign in as Mr Rao. In Settings, turn on **Notifications**.
3. Lock phone A, or switch to another app, or swipe the app away. On B, check **CBI parcel call**. A gets "Papa needs you now". Tap it: the app opens on "Papa's payment".
4. On A, block it. B (in another app, or locked) gets "Arjun blocked the payment". Tap it: "Payment cancelled".
5. On A, sign out. Check another scam on B: A stays quiet. Sign in on A as Meera: A rings for Meera's alerts only.
6. On A, block notifications in the phone's settings. The family home shows "Alerts only ring while this app is open". Mr Rao's STOP screen names the unreachable person.
7. The `/demo` event log shows every push: `Push notification sent to 1 phone (Arjun)` or `Push not delivered to Meera: …`. Delivery details are in the `push_notifications` table.
