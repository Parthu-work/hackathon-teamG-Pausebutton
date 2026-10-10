# Hindi and Telugu strings to sign off

Every Hindi and Telugu string this release added or changed, for a native
speaker's review before shipping. The strings live in `src/lib/i18n/hi.ts` and
`src/lib/i18n/te.ts` (English in `en.ts`); they were machine-written. The list
is the diff of those three files against the previous release (`bc5e6c8`).

Rules for the reviewer:
- Keep every placeholder exactly as written: `{name}`, `{minutes}`, `{n}`. The
  app fills it in; a changed or missing one shows the braces on screen.
- "Pause Button", "Android" and "Rs" stay as they are (the app's name, the
  platform, the currency as the English screens show it).
- Mr Rao's screens are the only ones translated. Family screens (`/family`)
  stay English, so a string here is seen by Mr Rao (or Mrs Rao), never by Arjun.
- To fix a string, edit `hi.ts` or `te.ts` only; `en.ts` and the keys stay.

## Added

### Home: the greeting by name

Shown as the title of Mr Rao's home screen (`src/screens/rao/home.tsx`) when
the account has a name ("Good morning, Ramesh"). Without a name the older
`home.morning` / `home.afternoon` / `home.evening` strings still show. `{name}`
is the person's first name as typed at sign-up.

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `home.morningName` | Good morning, {name} | सुप्रभात, {name} | శుభోదయం, {name} | Before noon. Keep `{name}`. |
| `home.afternoonName` | Good afternoon, {name} | नमस्ते, {name} | నమస్కారం, {name} | Noon to 5 pm. The Hindi and Telugu follow the existing `home.afternoon` ("नमस्ते" / "నమస్కారం"), not a literal "good afternoon": confirm that reads naturally with a name. |
| `home.eveningName` | Good evening, {name} | शुभ संध्या, {name} | శుభ సాయంత్రం, {name} | From 5 pm. Keep `{name}`. |

### Settings: payment hold time

A card on Mr Rao's Settings screen (`src/screens/rao/history.tsx`, the
"hold-time" card) with five chips: 5, 10, 15, 30, 60.

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `settings.holdTime` | Payment hold time | भुगतान रोकने का समय | చెల్లింపు ఆపే సమయం | Card title, also read out as the group's label. |
| `settings.holdTimeSub` | How long a paused payment waits for your family. A change applies to the next payment. | रोका गया भुगतान आपके परिवार के जवाब के लिए कितनी देर रुके। बदलाव अगले भुगतान पर लागू होगा। | ఆపిన చెల్లింపు మీ కుటుంబం జవాబు కోసం ఎంతసేపు వేచి ఉండాలి. మార్పు తదుపరి చెల్లింపుకు వర్తిస్తుంది. | Small text under the title. |
| `settings.holdTimeMinutes` | {n} min | {n} मिनट | {n} నిమి | The chip label; `{n}` is 5, 10, 15, 30 or 60. Must stay short (five chips in one row). Telugu uses an abbreviation ("నిమి"): confirm it is understood, or use the full word if it fits. |

### Settings and home: notifications in the Android app

Shown only inside the Android app (never in a browser). Before Android's own
"allow notifications?" prompt the app shows a sheet that says why
(`src/components/native-notifications.tsx`, copy wired in
`src/screens/rao/shell.tsx`); the sheet's second button is the existing
`common.notNow`. When notifications are off for the app, a banner on the home
screen and a row in Settings say so and open Android's settings for the app.

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `settings.notifyWhy` | So your family's alerts reach you | ताकि परिवार की चेतावनी आप तक पहुँचे | మీ కుటుంబం హెచ్చరికలు మీకు చేరాలంటే | Title of the "why" sheet, before Android's prompt. |
| `settings.notifyWhySub` | Android will ask if Pause Button may show notifications. Allow it, so a scam warning or your family's answer about a payment reaches you even when the app is closed. | Android पूछेगा कि क्या Pause Button सूचनाएँ दिखा सकता है। अनुमति दीजिए, ताकि धोखे की चेतावनी या भुगतान पर परिवार का जवाब आप तक पहुँचे, ऐप बंद हो तब भी। | Pause Button నోటిఫికేషన్లు చూపించవచ్చా అని Android అడుగుతుంది. అనుమతించండి, అప్పుడు మోసం హెచ్చరిక లేదా చెల్లింపు గురించి మీ కుటుంబం జవాబు యాప్ మూసి ఉన్నా మీకు చేరుతుంది. | Body of that sheet. "Android" and "Pause Button" stay in Latin letters. |
| `settings.notifyContinue` | Continue | आगे बढ़ें | కొనసాగించండి | The sheet's main button; tapping it shows Android's prompt. |
| `settings.notifyAppOff` | Notifications are off for Pause Button | Pause Button के लिए सूचनाएँ बंद हैं | Pause Button కి నోటిఫికేషన్లు ఆఫ్‌లో ఉన్నాయి | Banner title on the home screen, and the Settings row's status when Android has notifications off for the app. |
| `settings.notifyAppOffSub` | Your family's alerts reach you only while the app is open. Turn them on in your phone's settings. | परिवार की चेतावनी आप तक तभी पहुँचती है जब ऐप खुला हो। इन्हें अपने फ़ोन की सेटिंग में चालू कीजिए। | యాప్ తెరిచి ఉన్నప్పుడే మీ కుటుంబం హెచ్చరికలు మీకు చేరుతాయి. మీ ఫోన్ సెట్టింగ్స్‌లో వీటిని ఆన్ చేయండి. | Banner body. |
| `settings.notifyOpenSettings` | Turn on in Settings | सेटिंग में चालू करें | సెట్టింగ్స్‌లో ఆన్ చేయండి | Banner button; opens Android's notification settings for the app. |
| `settings.notifyErrorApp` | Could not turn on alerts on this phone. Try again. | इस फ़ोन पर चेतावनी चालू नहीं हो सकी। फिर कोशिश कीजिए। | ఈ ఫోన్‌లో హెచ్చరికలు ఆన్ చేయలేకపోయాం. మళ్ళీ ప్రయత్నించండి. | Error toast in Settings when registering for push fails inside the app. The browser version (`settings.notifyError`, unchanged) also says "or use Chrome"; this one must not. |

### Inbox: a message that could not be checked

Mr Rao's inbox list (`src/screens/rao/inbox.tsx`): the row of a watcher
message the server could not check, its status tag, and the toasts when he taps
it.

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `inbox.couldNotCheck` | We could not check this message | हम इस संदेश की जाँच नहीं कर पाए | ఈ మెసేజ్‌ని మేము తనిఖీ చేయలేకపోయాం | First line of the row; also the toast title when the text is no longer kept. |
| `inbox.tapToRetry` | Tap to check it again | दोबारा जाँचने के लिए टैप करें | మళ్ళీ తనిఖీ చేయడానికి నొక్కండి | Second line of the row (bold). |
| `inbox.checking` | Checking… | जाँच हो रही है… | తనిఖీ అవుతోంది… | The row's text while a check is running; also a toast when he taps a message being checked. Keep the ellipsis "…". |
| `inbox.retrying` | Checking again… | दोबारा जाँच हो रही है… | మళ్ళీ తనిఖీ అవుతోంది… | Replaces "Tap to check it again" while his tap is being handled. Keep "…". |
| `inbox.retryFailed` | Still could not check it. Try again in a while, or paste the message to check it. | अभी भी जाँच नहीं हो पाई। थोड़ी देर बाद फिर कोशिश कीजिए, या संदेश चिपकाकर जाँचिए। | ఇప్పటికీ తనిఖీ కాలేదు. కొంచెం ఆగి మళ్ళీ ప్రయత్నించండి, లేదా మెసేజ్‌ని పేస్ట్ చేసి తనిఖీ చేయండి. | Toast after a tap that failed again. The wording was changed during review (an earlier version promised "we will try again within 30 minutes"); the Hindi and Telugu were rewritten with it. |
| `inbox.statusFailed` | COULD NOT CHECK | जाँच नहीं हुई | తనిఖీ కాలేదు | Small status tag on the row (English is in capitals; Hindi and Telugu have no capitals, so the tag style carries it). |
| `inbox.statusChecking` | CHECKING | जाँच जारी | తనిఖీలో | Status tag while being checked. |
| `inbox.statusNotWatched` | NOT WATCHED | नज़र नहीं | గమనించలేదు | Status tag of a message from an app he does not watch (or a saved contact), when it has no verdict. Short; confirm "नज़र नहीं" / "గమనించలేదు" read as "not watched" rather than "not seen". |

### Privacy: what we keep

One more line in the "What we keep" list of the privacy screen
(`src/screens/rao/history.tsx`, `privacy.keep1` to `keep6`).

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `privacy.keep6` | The text of a message we could not check yet, for up to 24 hours, so we can try again | जिस संदेश की जाँच अभी नहीं हो पाई उसका पाठ, ज़्यादा से ज़्यादा 24 घंटे, ताकि हम फिर कोशिश कर सकें | ఇంకా తనిఖీ చేయలేకపోయిన మెసేజ్ పాఠ్యం, గరిష్ఠంగా 24 గంటలు, మళ్ళీ ప్రయత్నించడానికి | A list item, so no full stop, like the lines before it. Must say the same as `docs/retention.md`. |

## Changed

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `hold.twoKeysBody` | Above Rs 50,000 we hold for {minutes} minutes and ask two trusted people, the way a bank asks two signatures. | Rs 50,000 से ऊपर हम {minutes} मिनट रोकते हैं और दो भरोसेमंद लोगों से पूछते हैं, जैसे बैंक दो दस्तख़त माँगता है। | Rs 50,000 పైన అయితే {minutes} నిమిషాలు ఆపి, ఇద్దరు నమ్మకమైన వ్యక్తులను అడుగుతాం, బ్యాంక్ రెండు సంతకాలు అడిగినట్టు. | Was "we hold for an hour" ("एक घंटे" / "ఒక గంట"). The hold time is now a setting, so the sentence takes `{minutes}` (5, 10, 15, 30 or 60). Shown on the payment screen and the paused-payment screen when the amount is above Rs 50,000 (`src/screens/rao/evidence.tsx`, `hold.tsx`). Check that the plural form works for every value, 5 included. |

## Removed

| Key | English | Hindi | Telugu | Note |
|---|---|---|---|---|
| `share.pausedFor` | {amount} is paused for {n} minutes. Sent automatically at {time}. | {amount} {n} मिनट के लिए रोके गए हैं। {time} पर अपने आप भेजा गया। | {amount} {n} నిమిషాలు ఆపాం. {time}కి దానంతట అదే పంపాం. | Deleted from all three files: no screen used it. Nothing to review. |

## Not translated (by design)

The family app is English only, so these new English strings have no Hindi or
Telugu: the family's hold-time setting ("Papa's payment hold time", "From the
next paused payment"), the countdown's "left", the quiet-phone line ("Papa's
phone has not synced for over an hour: new messages may not be checked"), the
greeting on the family home ("Good morning, Arjun"), and the sign-in screens
(A0–A2: "Send code", "Type the code", "Resend code", "Your name", "Please enter
your name."), which come before the person has chosen a language. The Connect
screen (`src/screens/rao/watch.tsx`: "Not syncing since …", "Last sync at …",
"Allow message reading", "Connect this phone") and the Android app's own
notifications and consent screen are English only too.
