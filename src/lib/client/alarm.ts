"use client";

// Buzz, flash and sound for family alerts (C2, I1, O1). Browsers only allow
// sound after a tap, so the first tap anywhere (e.g. "Send me a test alert")
// unlocks audio for later alerts. On iPhone, websites cannot vibrate, so the
// flash and the sound carry the alert there.

let ctx: AudioContext | null = null;
let armed = false;

/** True once the person has tapped the page, which is when browsers allow sound and vibration. */
export function alarmsArmed() {
  return armed;
}

/** Call from a tap. Creates the audio context so later alerts can ring without another tap. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  armed = true;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio available */
  }
}

function tone(freq: number, start: number, dur: number, gain: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

export type AlarmSettings = { sound: boolean; vibrate: boolean };

/** urgent: loud repeating tone, long buzz and flash. quiet: one short chime and buzz. */
export function playAlarm(kind: "urgent" | "quiet", s: AlarmSettings) {
  // The screen flash never needs permission, so it always runs for urgent alerts.
  if (kind === "urgent") window.dispatchEvent(new Event("pb-flash"));
  if (!armed) return; // no tap yet: the browser would block sound and vibration
  if (s.sound) {
    if (kind === "urgent") {
      for (let i = 0; i < 6; i++) {
        tone(880, i * 0.5, 0.22, 0.25);
        tone(660, i * 0.5 + 0.25, 0.22, 0.25);
      }
    } else {
      tone(740, 0, 0.18, 0.12);
      tone(988, 0.2, 0.25, 0.12);
    }
  }
  if (s.vibrate) {
    try {
      navigator.vibrate?.(kind === "urgent" ? [400, 150, 400, 150, 400, 150, 800] : [150, 80, 150]);
    } catch {
      /* not supported */
    }
  }
}
