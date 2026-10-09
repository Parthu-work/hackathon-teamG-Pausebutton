// JSON shapes the API returns to the screens. Dates are ISO strings.
import type { AiStatus, Evidence, HardRule, LinkInfo, ScamFamily, Verdict } from "@/lib/check/types";

export type HoldStatus = "pending" | "blocked" | "approved" | "cancelled" | "expired";

export type AdviceView = { id: string; fromName: string; text: string; createdAt: string };

/** A protected person as their family member sees them. */
export type OwnerView = { id: string; name: string; callName: string; phone: string };

/** One family member's answer about a message. */
export type AnswerView = { memberId: string; name: string; verdict: "scam" | "not_scam"; at: string };

export type HoldView = {
  id: string;
  checkId: string;
  payee: string;
  amount: number;
  status: HoldStatus;
  expiresAt: string;
  createdAt: string;
  /** Blocked: who blocked it. Approved: everyone who approved (all alerted people must). */
  decidedByName: string | null;
  decidedAt: string | null;
  outcomeSeen: boolean;
  /** People who approved so far, and who still has to (approval needs everyone alerted). */
  approvedBy: string[];
  waitingFor: string[];
  phrases: string[];
  checkTitle: string;
  verdict: Verdict;
  advice: AdviceView[];
  /** Whose payment this is. */
  owner: OwnerView;
};

/** What the family member reads after opening an alert: the exact message, with its warning phrases. */
export type SharedMessage = { text: string; signals: Evidence[]; link: LinkInfo | null; source: "paste" | "sms" | "whatsapp"; senderLabel: string | null };

export type CheckView = {
  id: string;
  source: "paste" | "sms" | "whatsapp";
  senderLabel: string | null;
  title: string;
  verdict: Verdict;
  /** The verdict after family answered (their answer decides); same as verdict until then. */
  finalVerdict: Verdict;
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
  /** Who settled it: whoever said scam, or everyone who said it is fine ("Arjun and Meera"). */
  familyVerdictByName: string | null;
  /** Every family answer so far, and who has not answered yet (until it is settled). */
  answers: AnswerView[];
  waitingFor: string[];
  /** For a family member: may they still answer? (alerted, not answered, not settled) */
  canAnswer: boolean;
  /** Only for messages from the simulated inbox (the phone's own copy). */
  simText: string | null;
  /** The exact message (24 h): for the owner, and for family members who were alerted or asked. */
  messageText: string | null;
  /** Whose message this is. */
  owner: OwnerView;
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
  /** Whose message this alert is about (Papa, Mummy, …). */
  owner: OwnerView;
};

/** One person a family member protects, with everything their card and home screen show. */
export type ProtectedView = OwnerView & {
  online: boolean;
  relation: string;
  linkId: string;
  activeHold: HoldView | null;
  lastCheck: { id: string; verdict: Verdict; title: string; createdAt: string; phrases: string[] } | null;
  today: { total: number; scam: number; suspicious: number; safe: number };
  /** Open questions and heads-ups from this person. */
  openAlerts: number;
};

export type FamilyState = {
  me: { id: string; name: string; alertNotify: boolean; alertSound: boolean; alertVibrate: boolean; alertsReady: boolean };
  /** Everyone this family member protects (Arjun: Papa and Mummy). Empty until an invite is accepted. */
  people: ProtectedView[];
  alerts: AlertView[];
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
  owner: OwnerView;
};

/** An Android phone paired to watch messages (M2/M3 status). */
export type DeviceView = {
  id: string;
  name: string;
  paired: boolean;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
  lastMessageAt: string | null;
  listenerOn: boolean;
  messagesSeen: number;
};

export type EventView = { id: number; actor: string; type: string; message: string; createdAt: string };
