# Pause Button for Android

An app around the web app: **Capacitor** shows the hosted site (`PB_HOST`) in a WebView, full screen, with no address bar and no browser around it. Next.js keeps running on the server, so every screen works as on the web; the app adds what only a phone can do:

| Native piece | What it does |
|---|---|
| **`MainActivity`** | The app (Capacitor's `BridgeActivity`). Loads the site from `capacitor.config.ts` (`server.url`). A notification or the Share sheet opens it on a page of that site (intent extra `pb_url`, a path such as `/open/<alertId>`; nothing else is ever loaded). Schedules the 30-minute sync when the phone is connected. |
| **`PauseButtonNativePlugin`** | What the web app can ask of the phone (`registerPlugin("PauseButtonNative")`, wrapped in `src/lib/client/native.ts`): `pair`, `watcherStatus`, `openListenerSettings`, `openBatterySettings`, `disconnect`, `notificationStatus`, `requestNotifications`, `openNotificationSettings`, `pushAvailable`. The web app uses it on the Connect screen and wherever it asks for notifications. |
| **`MessageWatcherService`** | The real version of the simulated inbox (screens M1–M4): once the person agreed and allowed notification access, it reads new SMS and WhatsApp notifications and hands them to the **`Watcher`**, which posts them to `POST /api/device/inbox` and gets them there through an outage or a restart. See "The message watcher in the real world". |
| **`ConsentActivity`** | What is read, what leaves the phone and what is kept, before notification access is turned on. Until the person taps "I agree", the watcher reads nothing. |
| **`SyncWorker`** | The safety net, every 30 minutes with a network, even with the app closed: sends what waits, fetches the person's watch settings, and tells the server the phone is alive. See "The 30-minute sync". |
| **`PauseMessagingService`**, **`Alerts`**, **`NotificationActionReceiver`** | Push through Firebase Cloud Messaging, with the app closed too: shows each alert as a notification, with **Block payment** and **It's fine** on a paused payment (Block works from the lock screen), and confirms delivery to the server. See "Push". |
| **`ShareActivity`** | F1 · Forward to Pause: "Pause Button" in the Share sheet of WhatsApp, Messages and any app that shares text. Opens the app on `/share`, which checks the text at once; the verdict says which app it came from. |
| **`PairActivity`** | "Connect this phone" for a `pausebutton://pair?code=…&host=…` link opened outside the app (a browser, a QR). Inside the app, the web app's own Connect screen does the same through the plugin. |
| **`BootReceiver`** | After a reboot or an update: asks Android to bind the watcher again and makes sure the sync is scheduled. |

The plain-Java parts (`Outbox`, `Courier`, `Sync`, `SeenStore`, `RateGate`, `WatchRules`, `DayCounts`, `PushAlert`) hold the rules and are tested on the JVM.

## Build

Needs Node 24 with pnpm, JDK 21 (Android Studio's own works), and the Android SDK with `platforms;android-36` and build tools 35/36 (Gradle fetches what is missing once the SDK licences are accepted).

```bash
pnpm install
PB_HOST=https://your-deployment.example pnpm cap:sync   # the site the app opens, into the Android project
cd android
./gradlew assembleDebug                                  # → app/build/outputs/apk/debug/app-debug.apk
```

- **`PB_HOST`** is where the web app is deployed (default: the Railway URL). `pnpm cap:sync` writes it into the Android project (`app/src/main/assets/capacitor.config.json`, with the other generated files Git ignores), and the Gradle build reads it from there, so the WebView and the native code always use the same site. `-PPB_HOST=…` on Gradle must say the same, or the build stops and says so. Run `pnpm cap:sync` again after changing `PB_HOST`, `capacitor.config.ts` or a Capacitor version.
- **A laptop instead** (debug builds only): `PB_HOST=http://10.0.2.2:3000 PB_CLEARTEXT=1 pnpm cap:sync` for the emulator and `pnpm dev`, or the laptop's LAN address for a phone on the same Wi‑Fi. Release builds never allow plain http.
- `pnpm android:build` runs the sync and the debug build in one go.
- **Signing:** every build, on any laptop or in CI, signs with the shared debug key committed as `android/debug.keystore` (password `android`, alias `androiddebugkey`). The application id is still `ai.apty.pausebutton`, so this version (0.3) installs over the earlier ones (0.2, which opened the site in Chrome) and keeps the phone's connection to the watcher. Anyone with the repository can sign with this key: for a public release use your own (`./gradlew assembleRelease` with `PB_KEYSTORE`, `PB_KEYSTORE_PASSWORD`, `PB_KEY_ALIAS`, `PB_KEY_PASSWORD` as `-P…` or in `~/.gradle/gradle.properties`; without them the release build uses the debug key too).
- **CI** (`.github/workflows/ci.yml`, job "Android APK") syncs, runs the unit tests and builds both APKs on every push, and attaches the debug APK as **pause-button-debug-apk**. When the app changes on `main`, **Publish APK to the website** builds it for the live site and publishes it at `/pause-button.apk` (the QR code's download). Set the repository variable `PB_HOST` to point both at another deployment.

## Push (Firebase Cloud Messaging)

Browsers and iPhones get Web Push (`public/sw.js`). The Android app gets the same alerts through Firebase:

- The web app asks `pushAvailable()`; when Firebase is there it registers with `@capacitor/push-notifications` and sends the token to `POST /api/push/subscribe` (`{ fcmToken, app }`), where it is kept as a subscription of kind `fcm`. Signing out, or turning notifications off, forgets it.
- The server sends **data-only** messages (title, body, url, tag, urgent, kind, alertId, checkId, holdId, who, at, receipt, actions, all strings), so Android never shows anything by itself and the app always builds the notification: `PauseMessagingService` → `PushAlert` (the rules, the same as `public/sw.js`) → `Alerts`.
- Urgent alerts use the channel **Urgent alerts** (loud, vibrating, on the lock screen); everything else **Alerts**. A newer notification about the same message replaces the older one. A tap opens the app on the alert. **Block payment** blocks it straight from the notification, signed in as the family member through the app's own cookie, then shows "You blocked it" (or why not); **It's fine** opens the approve step, which always needs a second confirm.
- Each push is confirmed to the server (`POST /api/push/receipt`, shown or not and why), as the browser does, so a push that reaches no one is noticed.

**Setting it up:** see `docs/deploy.md`, "Android app: push with Firebase": a Firebase project with the Android app `ai.apty.pausebutton`, its `google-services.json` as the repository secret `GOOGLE_SERVICES_JSON` (CI writes it to `android/app/google-services.json`; for a local build put the file there yourself, Git ignores it), and a service account as `FCM_SERVICE_ACCOUNT` on the server. Without `google-services.json` the app builds and works, `pushAvailable()` says no, and alerts reach the phone only while the app is open (CI warns).

## Permissions, and how the app asks

Every permission is explained by the web app first, on its own screen; the native call comes after. Saying no always leaves the app usable.

| What | How it is asked | If the person says no |
|---|---|---|
| Notifications (Android 13+) | `requestNotifications()`: Android's own prompt, after the web app's explanation | The app works; alerts show inside it. After a refusal for good ("Don't allow" twice), the app never prompts again and offers `openNotificationSettings()` instead. Below Android 13 there is no prompt, only the switch in Android's settings. |
| Notification access (the message watcher) | `openListenerSettings()`: the consent screen first, then Android's list | Nothing is read; messages can still be pasted or shared in. |
| Running in the background | `openBatterySettings()`: Android's "Allow to always run in the background?" | The watcher works but the phone may pause it; the sync catches up. |

The app never asks for SMS or contacts permissions: it reads notifications, once the person agreed.

## The 30-minute sync

`SyncWorker` is a WorkManager periodic job (unique name `pb-sync`, every 30 minutes, only with a network, an existing schedule is kept). It runs `Watcher.syncNow`, on the watcher's own thread:

1. send what waits in the outbox, even a message still waiting out its backoff;
2. `GET /api/device/status`: the person's watch settings;
3. `POST /api/device/status {listenerOn, waiting, sync: true}`: the phone is alive, and this many messages still wait.

It is scheduled when the phone is connected, after a reboot and whenever the app starts; cancelled when the phone is disconnected here or removed on the web app (a 401). With no network it is retried by WorkManager. The server runs its own sync every 30 minutes too, re-checks what failed, and marks a phone it has not heard from in an hour as "not syncing".

## The message watcher in the real world

| What happens | What the watcher does | Where |
|---|---|---|
| No network, or the server is down | The message waits in an **outbox** file in the app's private, not-backed-up storage. It goes out **oldest first** once the network is back, or after a backoff (15 s, 30 s, 1 min … up to 15 min), or with the next sync. At most 50 wait (the oldest is dropped beyond that), and none longer than a day. | `Outbox`, `Courier`, `Watcher` |
| The same message is sent twice (a retry after a timeout, a restart) | Each message keeps one id from the moment it is seen; every try sends it as `Idempotency-Key` (and `messageId`), so the server checks it once. | `Outbox`, `Watcher` |
| The server answers 5xx or times out | Same as no network: retried later, the backoff growing. | `Courier` |
| The server answers 202 (it kept the message but its own check failed) | Delivered: the phone does not send it again; the server's sync checks it again. | `Courier` |
| The server answers 429 | Waits as long as its `Retry-After` says. A new message does not cut that wait short. | `Courier` |
| The server answers 401 | The phone was removed on the web app. It unpairs, drops what waits, stops the sync, and shows "Pause Button stopped checking messages". It does not retry. | `Courier`, `Watcher` |
| The server refuses one message (another 4xx) | That message is dropped and the rest go on. | `Courier` |
| The app is killed, the phone restarts | The outbox and the list of messages already sent are files, so nothing is lost and nothing is sent twice. After a reboot or an update, `BootReceiver` asks Android to rebind the listener, which then sends what waited. When the listener is cut off, it asks to be rebound. | `Outbox`, `SeenStore`, `BootReceiver`, `MessageWatcherService` |
| The same message again (chat apps re-post notifications) | Not sent again within 10 minutes. Only a salted hash of each message is kept, never its text. | `SeenStore` |
| A busy group chat | At most 4 a minute from one chat, 12 a minute in all, 300 a day. Beyond that, messages are skipped and counted, not queued. A stranger's message still gets through while a group is busy. | `RateGate` |
| A message from a saved contact, or from an app the person does not watch | Stays on the phone. The phone learns the person's choices (Settings › Watch my messages) from the server and applies them before sending. An SMS header such as `VM-HDFCBK` is a business, never a contact, so a bank lookalike is always checked. | `WatchRules` |
| "Disconnect this phone" | Forgets the connection and what waits at once, stops the sync, and tells the server (`POST /api/device/disconnect`), now or once the network is back, so the web app forgets the phone too. | `Watcher` |

**What we saw today** (`watcherStatus().today`, on the Connect screen): how many messages were read, sent, waiting, kept on the phone (contacts, apps not watched), repeats, skipped as too many, and dropped. Counts only, never senders or text.

## Tests

```bash
cd android
./gradlew testDebugUnitTest            # on the JVM (src/test): outbox, Idempotency-Key through retries and a restart,
                                       # 202, the sync's order, dedup, retries, rate cap, contacts, push rules
./gradlew connectedDebugAndroidTest    # on a device or emulator (src/androidTest): dedup and the outbox across a restart,
                                       # the Idempotency-Key, pairing, removal on the web app, disconnect on the phone,
                                       # and the 30-minute sync through WorkManager's test driver
```

Run `pnpm cap:sync` first (both need the generated Capacitor files). CI runs both: the unit tests in "Android APK", the device tests on an Android 14 emulator in "Android message watcher on an emulator".

## Install on a phone

1. Copy `app-debug.apk` to the phone (WhatsApp to yourself, Google Drive, USB, or `adb install -r app-debug.apk`), or open `<site>/download`.
2. Open it. Android asks to allow installing from this source once; allow it. Over an earlier Pause Button it installs as an update; the first time the new one opens, sign in again (it no longer opens through Chrome).
   If Android says "App not installed", an APK signed with a different key is already on the phone (builds before the shared key): uninstall it, then install again.

On the emulator:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell cmd notification allow_listener ai.apty.pausebutton/.MessageWatcherService
adb shell am start -a android.intent.action.VIEW -d "pausebutton://pair?code=XXXXXX&host=http://10.0.2.2:3000"
# a fake incoming SMS (debug builds accept notifications from the shell):
adb shell cmd notification post -S bigtext -t "+91 9XXXX XXXXX" demo "Sir this is CBI Mumbai. Stay on the call, tell no one, and transfer Rs 80,000."
# F1: share text to the app, as WhatsApp's Share sheet would:
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Sir this is CBI Mumbai. Stay on the call, tell no one, and transfer Rs 80,000." -n ai.apty.pausebutton/.ShareActivity
```

## On a real phone, before a release

Things an emulator test cannot do. Use two phones: Mr Rao's (the watcher) and a family member's.

1. **Fresh install.** Uninstall, install, open: the app opens straight on the site, with the Pause Button icon and name, no address bar. Sign in.
2. **Deny everything.** Say no to notifications (twice, so Android remembers), skip notification access and battery. The app still works: paste a message and get a verdict. The app does not ask for notifications again; it offers Android's settings instead.
3. **Grant everything.** Allow notifications, agree on the consent screen and allow notification access, allow background running. Send yourself an SMS from another phone: it shows in Pause Button within seconds, and the Connect screen counts it.
4. **Revoke in Settings.** Switch off notification access and notifications for the app in Android's settings, return to the app: the Connect screen says so (and the web app's list of phones shows it), with a way back.
5. **Offline.** Turn on airplane mode, send two SMS, wait a minute, turn it off: both arrive, oldest first, once each. The Connect screen shows "waiting for the internet" while offline.
6. **Reboot.** Reboot the phone and send an SMS without opening the app: it arrives. Within 30 minutes (with a network) the phone reports in by itself: the server records its last sync, and does not mark it "not syncing".
7. **App killed, then a scam SMS.** `adb shell am kill ai.apty.pausebutton` (or swipe it away), lock both phones, send a scam SMS to Mr Rao's phone: the family phone gets the alert on its lock screen with the app closed, and **Block payment** there works without unlocking (with a paused payment).
8. **Battery.** With battery optimisation on for the app ("Optimised"), leave the phone locked for 30 minutes, then send an SMS. If it does not arrive, the battery step is what fixes it.
9. **Busy group.** In a busy WhatsApp group, at most 4 messages a minute are sent; an SMS from an unknown number still arrives.
10. **Removal.** Remove the phone on the web app: the phone shows "Pause Button stopped checking messages". Connect again, then disconnect on the phone: the web app no longer lists it.

## Privacy

The watcher reads only *new* notifications from SMS and WhatsApp apps, and nothing before the person agrees on the consent screen. It sends the sender label and text to the server over HTTPS with the phone's token, and only for messages that are to be checked: messages from saved contacts (while "Only unknown senders" is on), from apps the person does not watch, repeats, and messages skipped in a flood stay on the phone. It never reads chat history and never sends messages.

On the phone it keeps:
- the token and the person's watch settings;
- today's counts;
- salted hashes of the messages seen in the last 10 minutes (to avoid repeats), never their text;
- the outbox: messages waiting for the network, at most 50, each deleted once sent or after a day. They are kept in app-private storage that is excluded from backups (`allowBackup="false"`, and `noBackupFilesDir`).

Disconnecting, here or on the web app, deletes the outbox. Google Play requires a prominent disclosure for notification access; the consent screen (`ConsentActivity`) and the web app's screen (M1) carry it, and a person qualified to judge Play policy should review both before a store release.
