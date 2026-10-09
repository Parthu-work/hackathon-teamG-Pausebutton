import type { CheckResult, ScamFamily, SignalType, Verdict } from "./types";

// All wording people see comes from these templates (not from the AI), so it
// stays plain, calm and translatable. {helper} is replaced with the first
// trusted person's name, e.g. "Arjun".

export const SIGNAL_LABEL: Record<SignalType, string> = {
  authority: "Authority",
  fear: "Fear",
  secrecy: "Secrecy",
  payment: "Payment",
};

export const SIGNAL_WHY: Record<SignalType, string> = {
  authority: "Police and agencies do not contact you like this.",
  fear: "A scary claim is used to make you panic.",
  secrecy: "Real officials never ask you to hide it from family.",
  payment: "No agency asks for money to “verify” you.",
};

type FamilyCopy = { title: string; story: string; scam: [string, string]; suspicious: [string, string] };

const FAMILY: Record<ScamFamily, FamilyCopy> = {
  fake_officer: {
    title: "A fake officer scam",
    story: "Callers pose as police or CBI, say you broke a law, and keep you on the phone. Then they demand money to “clear” it.",
    scam: ["Do not pay. Hang up.", "Real police never ask you to stay on the call, keep it secret, or pay money to “verify”."],
    suspicious: ["Be careful. Ask {helper} before you do anything.", "Real officials do not settle cases over the phone. Do not pay or share anything yet."],
  },
  bank_kyc: {
    title: "A fake bank KYC message",
    story: "The message says your account will be blocked unless you update KYC through a link. The link copies your bank's page and steals your login.",
    scam: ["Do not tap the link.", "Banks never block accounts by SMS or ask you to update KYC through a link."],
    suspicious: ["Be careful. Ask {helper} before you tap anything.", "Banks do not ask for KYC updates through links. Visit your branch instead."],
  },
  courier_fee: {
    title: "A fake courier fee",
    story: "The message says a parcel is stuck and asks for a small fee through a link. The link takes your card details.",
    scam: ["Do not pay this fee.", "Courier firms do not ask for fees through links like this."],
    suspicious: ["Be careful. Ask {helper} before you pay.", "Courier firms rarely ask for a fee through a link. Do not click it and do not pay yet."],
  },
  lottery: {
    title: "A fake prize",
    story: "You are told you won a big prize, but you must pay a fee first. There is no prize.",
    scam: ["Do not pay. There is no prize.", "Real prizes never ask you to pay a fee first."],
    suspicious: ["Be careful. Ask {helper} before you pay.", "If you did not enter a draw, you did not win one. Do not pay any fee."],
  },
  task_job: {
    title: "A fake task job",
    story: "You are paid small amounts for easy tasks, then asked to pay to unlock bigger earnings. The money never comes back.",
    scam: ["Do not pay to unlock tasks.", "Real jobs never ask you to pay to earn."],
    suspicious: ["Be careful. Ask {helper} first.", "Jobs that pay for liking videos usually end with a request for money."],
  },
  wrong_upi_refund: {
    title: "A “sent by mistake” trick",
    story: "Someone says they sent you money by mistake and asks you to send it back. Often no money was sent, or it was sent with a stolen account.",
    scam: ["Do not send any money back.", "Check your bank app yourself. If money really came, your bank will reverse it."],
    suspicious: ["Be careful. Ask {helper} before you send anything.", "Check your bank app yourself before you return any money."],
  },
  qr_receive: {
    title: "A QR code trick",
    story: "A buyer asks you to scan a QR code or enter your UPI PIN to receive money. Scanning or entering a PIN only ever sends money out.",
    scam: ["Do not scan. Do not enter your PIN.", "You never need to scan a QR code or enter your PIN to receive money."],
    suspicious: ["Be careful. Ask {helper} before you scan anything.", "You never need your UPI PIN to receive money."],
  },
  power_cut: {
    title: "A power cut threat",
    story: "The message says your electricity will be cut tonight unless you call or pay now. Power companies do not send messages like this.",
    scam: ["Do not call or pay.", "Check your bill on the official app or at the office counter."],
    suspicious: ["Be careful. Ask {helper} first.", "Check your bill on the official app before you call anyone."],
  },
  relative_emergency: {
    title: "A family emergency trick",
    story: "Someone pretends to be family with a new number and asks for money urgently, often saying not to tell others.",
    scam: ["Do not send money. Call them on their old number.", "Real family will not mind you checking first."],
    suspicious: ["Be careful. Call them on their old number.", "Check with the person directly before you send anything."],
  },
  investment: {
    title: "A fake investment",
    story: "You are promised big, guaranteed returns if you deposit money now. Guaranteed returns do not exist.",
    scam: ["Do not deposit any money.", "Nobody can guarantee returns like this."],
    suspicious: ["Be careful. Ask {helper} first.", "Promises of guaranteed returns are a warning sign."],
  },
  loan_fee: {
    title: "A fake loan offer",
    story: "A loan is offered but you must pay a fee first. The loan never comes.",
    scam: ["Do not pay any fee.", "Real lenders take fees from the loan, not before it."],
    suspicious: ["Be careful. Ask {helper} first.", "Real lenders do not ask for a fee before the loan."],
  },
  sim_block: {
    title: "A SIM block threat",
    story: "The message says your mobile number will be cut off and asks you to call an “officer”. TRAI does not do this.",
    scam: ["Do not call back.", "TRAI and phone companies do not threaten to block numbers like this."],
    suspicious: ["Be careful. Ask {helper} first.", "Phone companies do not threaten to cut numbers by message."],
  },
  tax_refund: {
    title: "A fake tax refund",
    story: "You are told you have a refund and must verify your details through a link. The link steals your bank login.",
    scam: ["Do not tap the link.", "Tax refunds go straight to your bank. No link is needed."],
    suspicious: ["Be careful. Ask {helper} first.", "Check refunds only on the official income tax website."],
  },
  remote_access: {
    title: "A screen-sharing trick",
    story: "You are asked to install an app like AnyDesk so “support” can help. The app lets them see and use your phone.",
    scam: ["Do not install any app.", "Real support never asks you to install a screen-sharing app."],
    suspicious: ["Be careful. Ask {helper} first.", "Do not install any app someone asks you to."],
  },
  otp_request: {
    title: "An OTP trick",
    story: "Someone asks for the code sent to your phone. That code lets them take money or your account.",
    scam: ["Do not share the code.", "Nobody genuine will ever ask for your OTP or PIN."],
    suspicious: ["Be careful. Ask {helper} first.", "Never share an OTP or PIN, even if the message looks real."],
  },
  pressure: {
    title: "A pressure scam",
    story: "The message tries to rush or scare you into acting before you can check with anyone.",
    scam: ["Do not do what it asks.", "Messages that rush you into paying or sharing are a common trick."],
    suspicious: ["Be careful. Ask {helper} before you act.", "Something in this message looks wrong. Do not pay or tap anything yet."],
  },
};

export function familyCopy(family: ScamFamily | null) {
  return FAMILY[family ?? "pressure"];
}

export function verdictCopy(result: Pick<CheckResult, "verdict" | "family">, helper: string, normalizedHint = "") {
  const fill = (s: string) => s.replaceAll("{helper}", helper);
  if (result.verdict === "SAFE") {
    const bank = /debited|credited|a\/c|avl bal|account ending/i.test(normalizedHint);
    return {
      headline: bank ? "This looks like a normal bank message." : "We found no warning signs.",
      body: bank
        ? "It does not ask for money, codes or secrecy. If you did not make this payment, call the number on your card."
        : "It does not ask for money, codes or secrecy.",
    };
  }
  const fc = familyCopy(result.family);
  const [headline, body] = result.verdict === "SCAM" ? fc.scam : fc.suspicious;
  return { headline: fill(headline), body: fill(body) };
}

export const VERDICT_PILL: Record<Verdict, { label: string; tone: "red" | "amber" | "green" }> = {
  SCAM: { label: "SCAM", tone: "red" },
  SUSPICIOUS: { label: "SUSPICIOUS", tone: "amber" },
  SAFE: { label: "SAFE", tone: "green" },
};

export const DO_LIST = (helpers: string) => [
  "Put the phone down. Hang up now.",
  `Wait for ${helpers}. They have been told.`,
  "Call the cyber helpline 1930.",
  "Keep the message. It is evidence.",
  "Check your bank using the number on your card.",
];

export const DONT_LIST = [
  "Do not pay or send any money.",
  "Do not tap any link or open any file.",
  "Do not call back or stay on the call.",
  "Do not share your OTP, PIN or card number.",
  "Do not keep it secret from your family.",
];

/** Advice the family member can send with one tap (I2). */
export const ADVICE_PRESETS = [
  "Hang up. Do not pay or click anything.",
  "Stay on the phone with me. I am calling now.",
  "Show this message to the bank or the police.",
];

/** "What to say" line for the family member's alert screens. */
export function whatToSay(verdict: Verdict, relation: string) {
  const name = relation || "Papa";
  return verdict === "SCAM"
    ? `“${name}, hang up. Do not send money. I am calling you now.”`
    : `“${name}, do not reply and do not pay. I am calling you.”`;
}

export function rupees(value: number) {
  return "Rs " + value.toLocaleString("en-IN");
}
