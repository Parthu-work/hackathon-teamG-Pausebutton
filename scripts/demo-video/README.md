# Demo video

`record.mjs` records the end-to-end demo against a running production build:
three phones (Mr Rao, Arjun, Meera) side by side with the service's live event
log, driven by a scripted cursor, with captions and chapter cards. Every frame
is captured over the DevTools protocol and encoded with ffmpeg, so the output
is crisp 1080p30 H.264 rather than a screen recording.

```sh
pnpm build
CRON_SECRET=demo-cron-key PGLITE_DIR=memory pnpm start -p 3300   # DEMO_SIGNIN open, no OPERATOR_KEY
BASE=http://localhost:3300 OUT=./scripts/demo-video/out FFMPEG=ffmpeg node scripts/demo-video/record.mjs
```

Outputs in `OUT`: `pause-button-demo.mp4` (with a quiet synthesized pad),
`pause-button-demo-silent.mp4`, `pause-button-demo.srt` (the captions as
subtitles), `narration.md` (the voice-over script with timestamps) and
`timeline.json`.

- Start the server fresh for every full take: with `PGLITE_DIR=memory` that is a
  restart. The demo reset keeps paired phones and reviewed domains, and chapter 6
  needs `sbi-kyc-verify.in` still unreported, chapter 9 no phone paired yet.
- `FAST=1` shortens every pause for a dry run; `ONLY=3,4` records only those
  chapters (chapter 0 is the cold open, 10 the closing).
- ffmpeg needs libx264 and aac. The Playwright bundle's ffmpeg has neither;
  `npm i @ffmpeg-installer/linux-x64` gives a static build.
- Only chapter 9 stands anything in: the Android bridge (`?app=1`) is the same
  stand-in `e2e/native-app.spec.ts` uses, because no emulator runs here. The
  screens, the server, pairing and every other chapter are the real product.

To add a recorded voice-over (`voice.wav`) under the pad:

```sh
ffmpeg -i pause-button-demo.mp4 -i voice.wav \
  -filter_complex "[0:a]volume=0.6[m];[m][1:a]amix=inputs=2:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k pause-button-demo-voiced.mp4
```
