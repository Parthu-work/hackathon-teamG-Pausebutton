"use client";

// F10 · Speak and listen. The verdict can read itself aloud (speech synthesis)
// and Mr Rao can say what the message or the caller said (speech recognition,
// Chrome on Android and desktop). Both are optional: when a phone cannot do
// one of them, the screens say so and fall back to reading and typing.

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

let current: SpeechSynthesisUtterance | null = null;

/** Reads the text aloud in the given language (BCP 47, e.g. "hi-IN"). Resolves when it ends or is stopped. */
export function speak(text: string, lang: string, onEnd?: () => void) {
  if (!canSpeak()) return false;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.9; // a little slower than the default: these are instructions
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
  if (voice) u.voice = voice;
  u.onend = () => {
    if (current === u) current = null;
    onEnd?.();
  };
  u.onerror = u.onend;
  current = u;
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  current = null;
  window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return canSpeak() && window.speechSynthesis.speaking;
}

type RecognitionCtor = new () => SpeechRecognitionLike;
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen() {
  return !!recognitionCtor();
}

export type Listener = { stop: () => void };

/**
 * Listens until stopped (or the phone stops by itself) and reports the text
 * so far. `onError` gets "denied" when the microphone is blocked.
 */
export function listen(
  lang: string,
  handlers: { onText: (text: string, final: boolean) => void; onEnd: () => void; onError: (kind: "denied" | "nothing" | "other") => void },
): Listener | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const piece = res[0]?.transcript ?? "";
      if (res.isFinal) finalText += (finalText ? " " : "") + piece.trim();
      else interim += piece;
    }
    handlers.onText((finalText + (interim ? " " + interim : "")).trim(), !interim);
  };
  r.onerror = (e) => handlers.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "nothing" : "other");
  r.onend = () => handlers.onEnd();
  try {
    r.start();
  } catch {
    handlers.onError("other");
    return null;
  }
  return { stop: () => r.stop() };
}
