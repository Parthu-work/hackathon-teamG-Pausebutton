// JSON shapes the API returns to the screens. Dates are ISO strings.
import type { AiStatus, Evidence, HardRule, LinkInfo, ScamFamily, Verdict } from "@/lib/check/types";

export type HoldStatus = "pending" | "blocked" | "approved" | "cancelled" | "expired";

export type AdviceView = { id: string; fromName: string; text: string; createdAt: string };

export type HoldView = {
  id: string;
  checkId: string;
  payee: string;
  amount: number;
  status: HoldStatus;
  expiresAt: string;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  outcomeSeen: boolean;
  phrases: string[];
  checkTitle: string;
  verdict: Verdict;
  advice: AdviceView[];
};

export type CheckView = {
  id: string;
  source: "paste" | "sms" | "whatsapp";
  senderLabel: string | null;
  title: string;
  verdict: Verdict;
  score: number;
  rulesScore: number;
  modelScore: number | null;
  hardRule: HardRule | null;
  decidedBy: "hard_rule" | "score" | "ai";
  signals: Evidence[];
  hardPhrases: { phrase: string; start: number; end: number }[];
  link: LinkInfo | null;
  family: ScamFamily | null;
  familyTitle: string | null;
  familyStory: string | null;
  headline: string;
  body: string;
  amount: number | null;
  amountText: string | null;
  payee: string | null;
  modelTerms: string[];
  aiStatus: AiStatus;
  aiModel: string | null;
  degraded: boolean;
  createdAt: string;
  alertedNames: string[];
  askedFamilyAt: string | null;
  familyVerdict: "scam" | "not_scam" | null;
  familyVerdictByName: string | null;
  /** Only for messages from the simulated inbox (the phone's own copy). */
  simText: string | null;
  hold: HoldView | null;
  advice: AdviceView[];
};

export type PersonView = {
  id: string;
  name: string;
  relation: string;
  phone: string;
  status: "waiting" | "linked";
  inviteCode: string;
  codeExpiresAt: string;
  codeExpired: boolean;
  earlyHeadsUp: boolean;
};

export type MeView = {
  id: string;
  name: string;
  phone: string;
  textSize: "A" | "A+" | "A++";
  language: string;
  watchSms: boolean;
  watchWhatsapp: boolean;
  unknownOnly: boolean;
  autoTellFamily: boolean;
};

export type SimMessageView = {
  id: string;
  channel: "sms" | "whatsapp";
  sender: string;
  fromContact: boolean;
  text: string;
  createdAt: string;
  checkId: string | null;
  verdict: Verdict | "SKIPPED" | null;
  phrases: string[];
};

export type RaoState = {
  me: MeView;
  people: PersonView[];
  helperNames: string[];
  activeHold: HoldView | null;
  /** A hold whose outcome Mr Rao has not seen yet (H3/H4/H5 open by themselves). */
  outcome: HoldView | null;
  banner: SimMessageView | null;
  serverNow: string;
};

export type AlertView = {
  id: string;
  kind: "urgent" | "headsup" | "ask";
  checkId: string;
  holdId: string | null;
  createdAt: string;
  openedAt: string | null;
  handledAt: string | null;
  verdict: Verdict;
  title: string;
  phrases: string[];
  amount: number | null;
  source: "paste" | "sms" | "whatsapp";
  senderLabel: string | null;
  otherRecipients: string[];
};

export type FamilyState = {
  me: { id: string; name: string; alertNotify: boolean; alertSound: boolean; alertVibrate: boolean; alertsReady: boolean };
  protectedUser: { id: string; name: string; phone: string; online: boolean; relation: string; linkId: string } | null;
  alerts: AlertView[];
  activeHold: HoldView | null;
  lastCheck: { id: string; verdict: Verdict; title: string; createdAt: string; phrases: string[] } | null;
  today: { total: number; scam: number; suspicious: number; safe: number };
  serverNow: string;
};

export type ActivityItem = {
  id: string;
  kind: "check" | "hold";
  label: "SCAM" | "SUSPICIOUS" | "SAFE" | "BLOCKED" | "APPROVED" | "CANCELLED";
  title: string;
  phrases: string[];
  createdAt: string;
  checkId: string;
};

export type EventView = { id: number; actor: string; type: string; message: string; createdAt: string };
