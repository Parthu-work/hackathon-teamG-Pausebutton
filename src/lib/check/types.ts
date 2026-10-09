export type SignalType = "authority" | "fear" | "secrecy" | "payment";
export const SIGNAL_TYPES: SignalType[] = ["authority", "fear", "secrecy", "payment"];

export type Verdict = "SCAM" | "SUSPICIOUS" | "SAFE";

/** live_call: the live-call guard (F6), decided from Mr Rao's answers, not from text. */
export type HardRule = "secrecy_payment" | "credential_request" | "bad_link" | "live_call";

/** Where a checked message came from. share = forwarded from another app (F1), voice = spoken (F10), call = the live-call guard (F6). */
export type CheckSource = "paste" | "sms" | "whatsapp" | "share" | "voice" | "call";

/** The live-call guard's three answers (F6b). */
export type CallAnswers = { video: boolean; money: boolean; secrecy: boolean };

export type ScamFamily =
  | "fake_officer"
  | "bank_kyc"
  | "courier_fee"
  | "lottery"
  | "task_job"
  | "wrong_upi_refund"
  | "qr_receive"
  | "power_cut"
  | "relative_emergency"
  | "investment"
  | "loan_fee"
  | "sim_block"
  | "tax_refund"
  | "remote_access"
  | "otp_request"
  | "pressure";

/** A phrase that triggered a signal. Offsets point into the original text. */
export type Evidence = {
  type: SignalType;
  phrase: string;
  start: number;
  end: number;
  by: "rules" | "ai";
};

export type LinkStatus = "known" | "unknown" | "risky" | "lookalike" | "blocked";

export type LinkInfo = {
  url: string;
  domain: string;
  status: LinkStatus;
  reason: string;
  start: number;
  end: number;
};

export type AiStatus = "not_needed" | "ok" | "unavailable" | "timeout" | "error";

export type CheckResult = {
  verdict: Verdict;
  /** The spam percentage shown to people: max(rules points, model score). */
  score: number;
  rulesScore: number;
  modelScore: number | null;
  hardRule: HardRule | null;
  decidedBy: "hard_rule" | "score" | "ai";
  signals: Evidence[];
  /** Phrases behind a hard rule that are not one of the four signals (e.g. "share the OTP"). */
  hardPhrases: { phrase: string; start: number; end: number }[];
  link: LinkInfo | null;
  family: ScamFamily | null;
  amount: { value: number; text: string } | null;
  payee: string | null;
  /** Top words from the fast-gate model, shown when the rules found nothing. */
  modelTerms: string[];
  ai: { status: AiStatus; model?: string; family?: string };
  /** The AI was needed for this message but did not answer. */
  degraded: boolean;
  /** No rule and no link matched; the AI's quoted phrases alone made it a SCAM (F8, the novel-scam escape hatch). */
  novel: boolean;
};
