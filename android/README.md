# Pause Button for Android

A small native app around the web app:

- **`LauncherActivity`** opens the web app as a *Trusted Web Activity*: full screen inside Chrome, so everything the web app does (push notifications, the dialer, vibration, the family screens) works unchanged. No Firebase and no WebView quirks.
- **`MessageWatcherService`** is the real version of the simulated inbox (screens M1–M4): once the person allows notification access, it reads new SMS and WhatsApp notifications and posts their text to `POST /api/device/inbox`, where the same check runs and the family gets its heads-up.
- **`PairActivity`** ("Connect this phone") connects the phone to the person's account with a short code from the web app (`Settings › Watch my messages › Connect this phone`), and helps with the two Android permissions (notification access, battery).
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
- **Signing:** every build, on any laptop or in CI, signs with the shared debug key committed as `android/debug.keystore` (password `android`, alias `androiddebugkey`), not your machine's own `~/.android/debug.keystore`. So a newer APK installs over an older one, and the site can vouch for the key (see "Full screen"). Anyone with the repository can sign with it: for a public release use your own key (`PB_KEYSTORE`, below).
- `./gradlew assembleRelease` signs with the debug key unless `PB_KEYSTORE`, `PB_KEYSTORE_PASSWORD`, `PB_KEY_ALIAS` and `PB_KEY_PASSWORD` are given (`-P…` or in `~/.gradle/gradle.properties`).
- CI builds the debug APK on every push and attaches it to the workflow run as **pause-button-debug-apk** (job "Android APK (debug)" in `.github/workflows/ci.yml`). When `android/` changes on `main`, **Publish APK to the website** rebuilds it for the live site and publishes it at `/pause-button.apk` (the QR code's download). Set the repository variable `PB_HOST` to point it at another deployment.

## Install on a phone

1. Copy `app-debug.apk` to the phone (WhatsApp to yourself, Google Drive, USB, or `adb install app-debug.apk`).
2. Open it. Android asks to allow installing from this source once; allow it.
   If Android says "App not installed", an APK signed with a different key is already on the phone (builds before the shared key, or one built with another key): uninstall it, then install again.
3. Follow the user manual (`docs/user-manual` artifact, linked from the main README).

## Full screen (no Chrome bar)

Chrome shows the site full screen only when the site vouches for the app: `https://<host>/.well-known/assetlinks.json` must list the app's package and signing fingerprint. The web app serves that file from the `ANDROID_CERT_SHA256` environment variable (comma-separated fingerprints), read on every request. For the shared debug key it is:

```
E1:5A:42:AC:11:84:2D:CA:5A:4D:E0:CC:B5:2F:85:A5:A3:EA:4C:49:3C:12:90:40:8E:ED:D2:D0:E8:C7:63:B0
```

(set on the Railway deployment). For another key, get its fingerprint with:

```bash
keytool -list -v -keystore android/debug.keystore -storepass android -alias androiddebugkey | grep SHA256
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

## Privacy

The watcher only reads *new* notifications from SMS and WhatsApp apps, dedupes them, and sends the sender label and text to the server over HTTPS with the phone's token. It never reads chat history, never sends messages, and keeps nothing on the phone besides the token and counters. Google Play requires a prominent disclosure for notification access; the Connect screen and the web app's consent screen (M1) carry it.
