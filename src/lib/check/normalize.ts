// Text normalisation shared by the rules and the fast gate.
//
// normalizeForMatch keeps a map from every output character back to the
// original string, so a phrase found in the normalised text can be
// highlighted in the message the person actually pasted.
//
// normalizeForGate is the exact input the fast-gate model was trained on.
// The training corpus is produced by running this same function
// (ml/prepare-corpus.ts), so training and scoring can never drift.

export type Normalized = {
  text: string;
  /** map[i] = UTF-16 index in the original string of output char i */
  map: number[];
};

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);

// Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKE: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "к": "k",
  "м": "m", "т": "t", "в": "b", "н": "h", "ο": "o", "α": "a", "ν": "v",
  "ρ": "p", "τ": "t", "ι": "i", "κ": "k", "ε": "e", "υ": "u", "χ": "x",
};

// Digits used as letters inside words: "acc0unt", "ver1fy", "bl0cked".
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" };

const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);
const SEPARATORS = new Set([" ", ".", "-", "_", "*"]);

export function normalizeForMatch(original: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];

  // 1. Per code point: drop zero-width, NFKC, lowercase, undo look-alikes.
  let index = 0;
  for (const cp of original) {
    const code = cp.codePointAt(0)!;
    if (!ZERO_WIDTH.has(code)) {
      const folded = cp.normalize("NFKC").toLowerCase();
      for (const ch of folded) {
        chars.push(LOOKALIKE[ch] ?? (/\s/u.test(ch) ? " " : ch));
        map.push(index);
      }
    }
    index += cp.length;
  }

  // 2. Leet digits with a letter on both sides become letters.
  for (let i = 1; i < chars.length - 1; i++) {
    const sub = LEET[chars[i]];
    if (sub && isLetter(chars[i - 1]) && isLetter(chars[i + 1])) chars[i] = sub;
  }

  // 3. Collapse spaced-out letters: "k.y.c", "u r g e n t" -> "kyc", "urgent".
  const keep = new Array<boolean>(chars.length).fill(true);
  let i = 0;
  while (i < chars.length) {
    const startsWord = !isWordChar(chars[i - 1]);
    if (startsWord && isLetter(chars[i]) && SEPARATORS.has(chars[i + 1] ?? "") ) {
      const sep = chars[i + 1];
      let j = i;
      let count = 1;
      while (chars[j + 1] === sep && isLetter(chars[j + 2]) && !isWordChar(chars[j + 3])) {
        j += 2;
        count++;
      }
      if (count >= 3) {
        for (let k = i + 1; k < j; k += 2) keep[k] = false;
        i = j + 1;
        continue;
      }
    }
    i++;
  }

  // 4. Collapse runs of spaces and trim.
  const outChars: string[] = [];
  const outMap: number[] = [];
  for (let k = 0; k < chars.length; k++) {
    if (!keep[k]) continue;
    if (chars[k] === " " && (outChars.length === 0 || outChars[outChars.length - 1] === " ")) continue;
    outChars.push(chars[k]);
    outMap.push(map[k]);
  }
  if (outChars[outChars.length - 1] === " ") {
    outChars.pop();
    outMap.pop();
  }
  return { text: outChars.join(""), map: outMap };
}

function isWordChar(ch: string | undefined) {
  return !!ch && /[\p{L}\p{N}\p{M}]/u.test(ch);
}

/** Maps a [start, end) span in normalised text back to the original string. */
export function toOriginalSpan(n: Normalized, start: number, end: number, original: string): [number, number] {
  const s = n.map[start] ?? 0;
  const lastIdx = n.map[Math.max(start, end - 1)] ?? s;
  // End just after the last mapped code point.
  const cp = original.codePointAt(lastIdx);
  const width = cp !== undefined && cp > 0xffff ? 2 : 1;
  return [s, lastIdx + width];
}

// ---------- fast-gate input ----------

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|net|org|co|info|top|xyz|live|click|link|icu|buzz|online|site|shop|club|work|rest|cyou|vip|tk|ml|ga|cf|gq|loan|win|bid|ly|gl|me|io|app|gov|sbi|bank)\b(?:\/\S*)?/giu;
const HANDLE_RE = /[\w.\-]+@[\w.\-]+/gu;
const AMOUNT_RE = /(?:\b(?:rs\.?|inr|rupees?)|₹)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:rs\.?|₹|inr|rupees?|lakh|lakhs|crore)\b/giu;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b1800[\s-]?\d{3}[\s-]?\d{4}\b/gu;
const NUMBER_RE = /\d+(?:[.,:\-/]\d+)*/gu;

/**
 * The text the fast gate scores. Links, payment handles, amounts, phone
 * numbers and other numbers are replaced with placeholder words so the
 * model learns "a link" or "an amount" rather than specific domains or
 * numbers (the public datasets use invented domains for scams and real
 * ones for safe rows, which would otherwise leak into the model).
 */
export function normalizeForGate(original: string): string {
  return normalizeForMatch(original)
    .text.replace(HANDLE_RE, " xhandle ")
    .replace(URL_RE, " xurl ")
    .replace(AMOUNT_RE, " xamount ")
    .replace(PHONE_RE, " xphone ")
    .replace(NUMBER_RE, " xnum ")
    .replace(/ {2,}/g, " ")
    .trim();
}
