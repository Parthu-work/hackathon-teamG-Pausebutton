# Pause Button for Android

A small native app around the web app:

- **`LauncherActivity`** opens the web app as a *Trusted Web Activity*: full screen inside Chrome, so everything the web app does (push notifications, the dialer, vibration, the family screens) works unchanged. No Firebase and no WebView quirks.
- **`MessageWatcherService`** is the real version of the simulated inbox (screens M1–M4): once the person agreed and allowed notification access, it reads new SMS and WhatsApp notifications and hands them to the **`Watcher`**, which posts their text to `POST /api/device/inbox` (where the same check runs and the family gets its heads-up) and gets them there through a network outage or a restart. See "The message watcher in the real world" below.
- **`ConsentActivity`** says what is read, what leaves the phone and what is kept, before notification access is turned on. Until the person taps "I agree", the watcher reads nothing.
- **`PairActivity`** ("Connect this phone") connects the phone to the person's account with a short code from the web app (`Settings › Watch my messages › Connect this phone`), helps with the two Android permissions (notification access, battery), shows **what we saw today**, and disconnects the phone here and on the web app at once.
- **`BootReceiver`** asks Android to bind the watcher again after a reboot or an app update.
- **`ShareActivity`** (F1 · Forward to Pause) puts "Pause Button" in the Share sheet of WhatsApp, Messages and any app that shares text. The shared text is handed to the web app's `/share` page, which checks it at once; the verdict says which app it came from.

The web app's address is baked in at build time (`PB_HOST`) and can be changed on the Connect screen.

Phase 2 features that need nothing native, and so work in this app as they do in the browser: lock-screen notifications with **Block payment** built in (F2, Web Push actions handled by `public/sw.js`), the live-call guard (F6), reading aloud and speaking (F10, Chrome's Web Speech), Hindi and Telugu (F5).

**Push notifications** need nothing native either. Because the web app runs inside Chrome, Chrome asks for the notification permission (the app's "Notifications" toggle), shows the system notifications while the app is in the background, closed or the phone locked, and a tap opens the app straight on the alert (`/open/<alertId>` on a family phone, `/check/<id>` or `/hold/<id>` on the protected person's phone). With the site's `/.well-known/assetlinks.json` verified for this app's signing key, the tap opens full screen inside the app; otherwise it opens in Chrome. The app also declares the Trusted Web Activity **notification delegation** service (`DelegationService` and `NotificationPermissionRequestActivity` in the manifest), so with a verified site the notifications show as Pause Button's own and Android 13+ asks for the permission through the app. The message watcher's own uploads (`POST /api/device/inbox`) are what trigger the "Possible scam from …" notification on the protected person's phone and the heads-up on the family's. There is no Firebase and no FCM: see the main README, "Push notifications".

## Build

Needs Android Studio (for its JDK and SDK) or any JDK 17+ plus the SDK packages `platforms;android-37.2`, `build-tools;36.0.0`, `platform-tools`.

```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # macOS; or any JDK 17+
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug -PPB_HOST=https://your-deployment.vercel.app
# → app/build/outputs/apk/debug/app-debug.apk
```

- `PB_HOST` is where the web app is deployed. For the emulator use `http://10.0.2.2:3000` (the host machine's `pnpm dev`); for a phone on the same Wi‑Fi use the laptop's address, e.g. `http://192.168.1.20:3000`; for anyone anywhere, the Vercel URL or a `pnpm share` tunnel link.
- `./gradlew assembleRelease` signs with the debug key unless `PB_KEYSTORE`, `PB_KEYSTORE_PASSWORD`, `PB_KEY_ALIAS` and `PB_KEY_PASSWORD` are given (`-P…` or in `~/.gradle/gradle.properties`).
- CI builds the debug APK on every push and attaches it to the workflow run as **pause-button-debug-apk** (job "Android APK (debug)" in `.github/workflows/ci.yml`). Set the repository variable `PB_HOST` to your deployment.

## Install on a phone

1. Copy `app-debug.apk` to the phone (WhatsApp to yourself, Google Drive, USB, or `adb install app-debug.apk`).
2. Open it. Android asks to allow installing from this source once; allow it.
3. Follow the user manual (`docs/user-manual` artifact, linked from the main README).

## Full screen (no Chrome bar)

Chrome shows the site full screen only when the site vouches for the app: `https://<host>/.well-known/assetlinks.json` must list the app's package and signing fingerprint. The web app serves that file from the `ANDROID_CERT_SHA256` environment variable (comma-separated fingerprints). Get a fingerprint with:

```bash
keytool -list -v -keystore ~/.android/debug.keystore -storepass android -alias androiddebugkey | grep SHA256
```

Without it the app still works; Chrome just shows its address bar.

## Testing on the emulator

```bash
emulator -avd pb_pixel &                                   # created by the setup; any Play-Store image works
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell cmd notification allow_listener ai.apty.pausebutton/.MessageWatcherService
adb shell am start -a android.intent.action.VIEW -d "pausebutton://pair?code=XXXXXX&host=http://10.0.2.2:3000"
# a fake incoming SMS (debug builds accept notifications from the shell):
adb shell cmd notification post -S bigtext -t "+91 9XXXX XXXXX" demo "Sir this is CBI Mumbai. Stay on the call, tell no one, and transfer Rs 80,000."
# F1: share text to the app, as WhatsApp's Share sheet would:
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Sir this is CBI Mumbai. Stay on the call, tell no one, and transfer Rs 80,000." -n ai.apty.pausebutton/.ShareActivity
```

The message appears on Mr Rao's phone (My checks, the inbox) and the family phones get the heads-up.

## The message watcher in the real world

| What happens | What the watcher does | Where |
|---|---|---|
| No network, or the server is down | The message waits in an **outbox** file in the app's private, not-backed-up storage. It goes out **oldest first** once the network is back, or after a backoff (15 s, 30 s, 1 min … up to 15 min). At most 50 wait (the oldest is dropped beyond that), and none longer than a day. | `Outbox`, `Courier`, `Watcher` |
| The server answers 5xx or times out | Same as no network: retried later, the backoff growing. | `Courier` |
| The server answers 429 | Waits as long as its `Retry-After` says. A new message does not cut that wait short. | `Courier` |
| The server answers 401 | The phone was removed on the web app. It unpairs, drops what waits, and shows "Pause Button stopped checking messages". It does not retry. | `Courier`, `Watcher` |
| The server refuses one message (another 4xx) | That message is dropped and the rest go on. | `Courier` |
| The app is killed, the phone restarts | The outbox and the list of messages already sent are files, so nothing is lost and nothing is sent twice. After a reboot or an update, `BootReceiver` asks Android to rebind the listener, which then sends what waited. When the listener is cut off, it asks to be rebound. | `Outbox`, `SeenStore`, `BootReceiver`, `MessageWatcherService` |
| The same message again (chat apps re-post notifications) | Not sent again within 10 minutes. Only a salted hash of each message is kept, never its text. | `SeenStore` |
| A busy group chat | At most 4 a minute from one chat, 12 a minute in all, 300 a day. Beyond that, messages are skipped and counted, not queued. A stranger's message still gets through while a group is busy. | `RateGate` |
| A message from a saved contact, or from an app the person does not watch | Stays on the phone. The phone learns the person's choices (Settings › Watch my messages) from the server and applies them before sending. An SMS header such as `VM-HDFCBK` is a business, never a contact, so a bank lookalike is always checked. | `WatchRules` |
| "Disconnect this phone" on the phone | Forgets the connection and what waits at once, and tells the server (`POST /api/device/disconnect`), now or once the network is back, so the web app forgets the phone too. | `Watcher` |

**What we saw today** (Connect screen): how many messages were read, sent, waiting, kept on the phone (contacts, apps not watched), repeats, skipped as too many, and dropped. Counts only, never senders or text.

## Tests

```bash
cd android
./gradlew testDebugUnitTest            # the watcher's rules on the JVM: outbox, dedup, retries, rate cap, contacts (src/test)
./gradlew connectedDebugAndroidTest    # on a device or emulator: dedup and the outbox across a restart, pairing,
                                       # removal on the web app, disconnect on the phone (src/androidTest)
```

CI runs both: the unit tests in "Android APK (debug)", the device tests on an Android 14 emulator in "Android message watcher on an emulator".

**On a real phone, before a release** (things an emulator test cannot do):
1. Connect the phone, agree, allow notification access. Send yourself an SMS from another phone: it shows in Pause Button within seconds, and the Connect screen counts it.
2. Turn on airplane mode, send two SMS, wait a minute, turn it off: both arrive, oldest first. The Connect screen shows "waiting for the internet" while offline.
3. Reboot the phone and send an SMS without opening the app: it arrives. Then `adb shell am kill ai.apty.pausebutton` and send another: it arrives.
4. With battery optimisation on for the app ("Optimised"), leave the phone locked for 30 minutes, then send an SMS. If it does not arrive, the Connect screen's battery step is what fixes it.
5. In a busy WhatsApp group, at most 4 messages a minute are sent; an SMS from an unknown number still arrives.
6. Remove the phone on the web app: the phone shows "Pause Button stopped checking messages". Connect again, then "Disconnect this phone" on the phone: the web app no longer lists it.

## Privacy

The watcher reads only *new* notifications from SMS and WhatsApp apps, and nothing before the person agrees on the consent screen. It sends the sender label and text to the server over HTTPS with the phone's token, and only for messages that are to be checked: messages from saved contacts (while "Only unknown senders" is on), from apps the person does not watch, repeats, and messages skipped in a flood stay on the phone. It never reads chat history and never sends messages.

On the phone it keeps:
- the token and the person's watch settings;
- today's counts;
- salted hashes of the messages seen in the last 10 minutes (to avoid repeats), never their text;
- the outbox: messages waiting for the network, at most 50, each deleted once sent or after a day. They are kept in app-private storage that is excluded from backups (`allowBackup="false"`, and `noBackupFilesDir`).

Disconnecting, here or on the web app, deletes the outbox. Google Play requires a prominent disclosure for notification access; the consent screen (`ConsentActivity`) and the web app's screen (M1) carry it, and a person qualified to judge Play policy should review both before a store release.
