import { normalizeForMatch, toOriginalSpan, type Normalized } from "./normalize";
import type { Evidence, ScamFamily, SignalType } from "./types";

// Phrase patterns run on normalised, lower-case text. Each list holds regex
// fragments; build() adds Unicode-aware word boundaries.
// Sources: the design's four signals, the RBI BE(A)WARE booklet and the
// I4C digital-arrest advisory (see the research notes in the repo README).

const B = String.raw`(?<![\p{L}\p{N}\p{M}])`;
const E = String.raw`(?![\p{L}\p{N}\p{M}])`;
const build = (parts: string[]) => new RegExp(`${B}(?:${parts.join("|")})${E}`, "gu");

const AMT = String.raw`(?:rs\.?|₹|inr)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakh|lakhs|crore))?`;

const SIGNAL_PATTERNS: Record<SignalType, RegExp> = {
  authority: build([
    "cbi(?: (?:mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|headquarters|hq|office))?", "central bureau of investigation", "enforcement directorate", "ed (?:officer|office|department|notice)",
    "police", "cyber (?:crime|cell|police)", "crime branch", "narcotics control bureau", "ncb", "customs?(?: (?:dept|department|office|officer|duty|counter))?",
    "income tax department", "it department", "reserve bank(?: of india)?", "rbi", "trai", "telecom department",
    "department of telecommunications", "supreme court", "high court", "court", "judge", "magistrate", "interpol",
    "inspector", "officer", "sebi(?: registered)?",
    "pulis", "thana", "adhikari", "पुलिस", "सीबीआई", "कस्टम", "अधिकारी", "थाना", "పోలీస్", "పోలీసు", "సీబీఐ", "అధికారి",
  ]),
  fear: build([
    "illegal(?: items| activity| activities| goods)?", "drugs?", "mdma", "narcotics", "fake passports?", "money laundering",
    "digital arrest", "arrest(?:ed)?", "arrest warrant", "warrant", "fir", "case (?:has been |is )?(?:registered|filed|darj)",
    "case darj", "legal action", "jail", "prison", "giraftar(?:i)?",
    "(?:will be|has been|is being|shall be) (?:blocked|suspended|deactivated|disconnected|closed|frozen|seized|cancelled|terminated)",
    "blocked (?:today|permanently|tonight)", "suspension", "disconnection", "penalty", "last warning",
    "final (?:notice|warning)", String.raw`within \d+ (?:hours?|hrs?|minutes?|mins?)`, "today itself", "immediately",
    "urgent(?:ly)?", "turant", "jaldi", "act now", "expires? today", "in (?:big )?trouble", "band ho (?:jayega|jaega|jaayega)",
    "गिरफ्तार(?:ी)?", "बंद हो जाएगा", "तुरंत", "బ్లాక్ అవుతుంది", "వెంటనే",
  ]),
  secrecy: build([
    "tell no ?one", "do(?:n'?t|nt| not) tell (?:anyone|anybody|any one|your family|family|mummy|mum|mom|papa|your wife|your husband|your son|your daughter|your children)",
    "do(?:n'?t|nt| not) inform (?:anyone|anybody|any one|your family|family|the police|police)",
    "without (?:telling|informing) (?:anyone|anybody|your family|family)",
    "keep (?:this|it) (?:a )?(?:secret|confidential|between us)", "strictly confidential", "secret",
    "stay on (?:the |this )?(?:video )?(?:call|line)", "(?:be|remain|stay) on (?:the )?video call",
    "do(?:n'?t|nt| not) (?:disconnect|cut|end) (?:the |this )?(?:call|phone|line)", "do(?:n'?t|nt| not) disconnect",
    "bane rahiye", "bane rahein", "call (?:mat|na) kaat(?:na|iye|ein)?",
    "kisi ko (?:bhi )?(?:mat|na|nahi) bata(?:na|yein|yen|ein|o|iye|na)?",
    "किसी को (?:भी )?(?:मत|न|ना) बता(?:ना|एं|एँ|ओ|इए|ें)?", "ఎవరికీ చెప్పకండి", "ఎవరికీ చెప్పవద్దు",
  ]),
  payment: build([
    `transfer(?: ${AMT})?`, `send (?:${AMT}|money|the money|the amount|it back)`,
    `pay(?:ing)? ${AMT}(?: (?:fee|fees|charge|charges|duty))?`,
    "pay (?:a |the )?(?:[a-z]+ )?(?:fee|fees|charge|charges|duty|deposit|amount)", "pay (?:now|immediately|today|online|by qr(?: code)?)",
    "(?:processing|registration|clearance|redelivery|verification|insurance|activation|unlock|release|customs) (?:fee|fees|charge|charges|amount|duty)",
    `deposit(?: ${AMT})?`, "security deposit", "refundable", "verification account", "(?:rbi )?safe account",
    "(?:return|refund|send back) (?:it|the money|the amount|my money)", "scan (?:the |this |my )?qr(?: code)?",
    "enter (?:your )?upi pin", "gift cards?", "bitcoin", "crypto(?:currency)?",
    "pais[ae] (?:bhej(?:o|iye|en|ein|do|na)|transfer)", "bhej(?:iye|do|dijiye)", "jama kar(?:o|en|ein|iye)",
    "जमा कर(?:ें|ो|िए|ें)", "भेज(?:ें|ो|िए|ना)", "फीस", "शुल्क", "చెల్లించండి", "పంపండి",
  ]),
};

// Hard rule H2: asks for a code, PIN or password, or for a screen-sharing app.
const CREDENTIAL = build([
  String.raw`(?<!(?:not|never|n'?t|nt|na|mat|nahi) )(?:share|send|tell|give|forward|provide|enter|confirm|read out) (?:me |us )?(?:the |your |this |that )?(?:otp|one time password|pin|mpin|upi pin|atm pin|cvv|password|card number|card details|net ?banking (?:password|details))`,
  String.raw`otp (?:share|bata\p{L}*|bhej\p{L}*)(?! (?:na|mat|nahi|not))`,
  "any ?desk", "team ?viewer", "quick ?support", "rust ?desk", "screen ?shar(?:e|ing)(?: app)?",
]);

// A secrecy phrase right next to OTP/PIN is a bank's safety warning, not a scam.
const CREDENTIAL_WORD = /(?<![\p{L}])(?:otp|o\.t\.p|pin|mpin|password|cvv)(?![\p{L}])|ओटीपी|పిన్/u;

export type RuleHit = { phrase: string; start: number; end: number };

export type RuleFindings = {
  normalized: Normalized;
  signals: Evidence[];
  credential: RuleHit[];
};

export function runRules(original: string): RuleFindings {
  const normalized = normalizeForMatch(original);
  const text = normalized.text;
  const signals: Evidence[] = [];

  for (const type of Object.keys(SIGNAL_PATTERNS) as SignalType[]) {
    for (const m of text.matchAll(SIGNAL_PATTERNS[type])) {
      const s = m.index!;
      const e = s + m[0].length;
      if (type === "secrecy" && CREDENTIAL_WORD.test(text.slice(Math.max(0, s - 40), e + 40))) continue;
      const [os, oe] = toOriginalSpan(normalized, s, e, original);
      signals.push({ type, phrase: original.slice(os, oe), start: os, end: oe, by: "rules" });
    }
  }

  const credential: RuleHit[] = [];
  for (const m of text.matchAll(CREDENTIAL)) {
    const [os, oe] = toOriginalSpan(normalized, m.index!, m.index! + m[0].length, original);
    credential.push({ phrase: original.slice(os, oe), start: os, end: oe });
  }

  return { normalized, signals: dedupe(signals), credential };
}

/** Drop phrases contained in a longer phrase of the same type. */
function dedupe(list: Evidence[]): Evidence[] {
  return list.filter(
    (a, i) =>
      !list.some((b, j) => j !== i && b.type === a.type && b.start <= a.start && b.end >= a.end && (b.end - b.start > a.end - a.start || j < i)),
  );
}

// ---------- scam family (for the explanation copy) ----------

const FAMILY_RULES: [ScamFamily, RegExp[]][] = [
  ["remote_access", [/any ?desk|team ?viewer|quick ?support|screen ?shar/u]],
  ["qr_receive", [/qr|upi pin/u, /receive|get (?:the )?(?:money|payment|amount)|credit/u]],
  ["wrong_upi_refund", [/by mistake|wrongly|galti se|accidentally|mistakenly/u, /return|refund|send (?:it )?back|wapas/u]],
  ["fake_officer", [/cbi|police|narcotics|ncb|enforcement directorate|crime branch|cyber crime|court|judge|inspector|customs officer|पुलिस|सीबीआई|పోలీస్/u, /arrest|warrant|fir|case|drugs?|illegal|laundering|parcel|courier|गिरफ्तार/u]],
  ["bank_kyc", [/kyc|pan (?:card )?update|update (?:your )?pan|aadhaar link|yono|net ?banking/u]],
  ["courier_fee", [/parcel|courier|shipment|delivery|redelivery|india ?post|blue ?dart|fedex|dhl|delhivery|customs/u, /fee|charge|duty|pay/u]],
  ["lottery", [/lottery|lucky draw|jackpot|kbc|you (?:have )?won|has won|winner|prize|लॉटरी|इनाम/u]],
  ["task_job", [/part ?time|work from home|daily (?:earn|income)|like (?:youtube )?videos|telegram|tasks?|commission/u]],
  ["investment", [/stock tips|guaranteed (?:returns?|profit)|double your money|trading|ipo|forex|crypto/u]],
  ["loan_fee", [/loan/u, /fee|charge|insurance|processing/u]],
  ["power_cut", [/electricity|power|bijli|light bill/u, /disconnect|cut|kat/u]],
  ["sim_block", [/sim|mobile number|trai/u, /block|disconnect|deactivat/u]],
  ["tax_refund", [/tax/u, /refund/u]],
  ["relative_emergency", [/new number|phone (?:fell|is lost|broke|got lost)|lost my phone|accident|hospital/u, /send|need|transfer|upi/u]],
  ["otp_request", [/otp|one time password/u]],
];

export function detectFamily(normalizedText: string): ScamFamily {
  for (const [family, patterns] of FAMILY_RULES) {
    if (patterns.every((p) => p.test(normalizedText))) return family;
  }
  return "pressure";
}

// ---------- amount and payee (for the payment hold) ----------

const AMOUNT_RE = /(?:rs\.?|₹|inr|rupees?)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(lakh|lakhs|crore))?|(\d[\d,]*(?:\.\d+)?)\s?(lakh|lakhs|crore)?\s?(?:rupees|रुपये|రూపాయలు)/giu;

export function findAmount(
  original: string,
  paymentSignals: Evidence[],
): { value: number; text: string } | null {
  const amounts = [...original.matchAll(AMOUNT_RE)].map((m) => {
    const raw = (m[1] ?? m[3] ?? "0").replace(/,/g, "");
    const unit = (m[2] ?? m[4] ?? "").toLowerCase();
    const mult = unit.startsWith("lakh") ? 100000 : unit === "crore" ? 10000000 : 1;
    return { value: Math.round(parseFloat(raw) * mult), text: m[0].trim(), start: m.index! };
  });
  if (!amounts.length || !paymentSignals.length) return null;
  // Prefer the amount inside or just after a payment phrase ("transfer Rs 80,000",
  // "pay Rs 6,500 fee"), not a prize amount elsewhere in the message.
  for (const p of paymentSignals) {
    const near = amounts.find((a) => a.start >= p.start - 2 && a.start <= p.end + 40);
    if (near) return { value: near.value, text: near.text };
  }
  const largest = amounts.reduce((a, b) => (b.value > a.value ? b : a));
  return { value: largest.value, text: largest.text };
}

export function findPayee(normalizedText: string): string {
  if (/verification account/u.test(normalizedText)) return "Verification Account";
  if (/safe account/u.test(normalizedText)) return "“RBI safe account”";
  const handle = normalizedText.match(/[\w.\-]+@(?:ybl|okaxis|oksbi|okhdfcbank|okicici|paytm|upi|ibl|axl|apl)\b/u);
  if (handle) return handle[0];
  if (/qr/u.test(normalizedText)) return "QR code sender";
  if (/upi/u.test(normalizedText)) return "Unknown UPI ID";
  return "Unknown account";
}
