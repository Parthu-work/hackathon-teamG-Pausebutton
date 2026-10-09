// JSON shapes the API returns to the screens. Dates are ISO strings.
import type { AiStatus, CallAnswers, CheckSource, Evidence, HardRule, LinkInfo, ScamFamily, Verdict } from "@/lib/check/types";

export type HoldStatus = "pending" | "blocked" | "approved" | "cancelled" | "expired";
export type Language = "en" | "hi" | "te";

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
  /** F13: above Rs 50,000 the hold lasts an hour and release needs every trusted person. */
  twoKeys: boolean;
  holdMinutes: number;
};

/** What the family member reads after opening an alert: the exact message, with its warning phrases. */
export type SharedMessage = { text: string; signals: Evidence[]; link: LinkInfo | null; source: CheckSource; senderLabel: string | null };

/** F3: the same message seen by other households, counted by fingerprint only. */
export type CampaignView = {
  /** Other households that got this message in the last 24 hours. */
  households: number;
  firstSeenAt: string;
  /** More than a handful in a day: "spreading fast". */
  spreading: boolean;
};

/** F9a: the link in the message, as the family member can report it. */
export type ReportableLink = {
  domain: string;
  status: LinkInfo["status"];
  reason: string;
  /** Official sites cannot be reported. */
  protectedSite: boolean;
  /** This member already reported it, or it is already blocked. */
  reported: "none" | "pending" | "blocked" | "rejected";
  /** Households kept away from reported-and-blocked sites this week. */
  familiesProtected: number;
};

export type CheckView = {
  id: string;
  source: CheckSource;
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
  aiScamType: string | null;
  degraded: boolean;
  /** F8: no rule matched; the AI's own quoted words convicted it. */
  novel: boolean;
  /** F6: the live-call guard's answers, for a check with source "call". */
  callAnswers: CallAnswers | null;
  /** F3: other households that got the same message (null when it is only this one). */
  campaign: CampaignView | null;
  /** F9a: for family members, the link they can report. */
  reportable: ReportableLink | null;
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
  language: Language;
  watchSms: boolean;
  watchWhatsapp: boolean;
  unknownOnly: boolean;
  autoTellFamily: boolean;
  /** Push notifications on his own phone (detected messages, the family's decision). */
  alertNotify: boolean;
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
  source: CheckSource;
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

/** F12: the household ledger, this month, for a family member. */
export type LedgerView = {
  /** "October 2026" */
  month: string;
  paused: number;
  /** Rupees kept in the account: blocked holds this month. */
  heldAmount: number;
  checked: number;
  fine: number;
  stopped: { holdId: string; checkId: string; title: string; amount: number; by: string; at: string; owner: string }[];
  /** Quickest block this month, from alert to decision. */
  fastest: { ms: number; title: string; by: string } | null;
  /** Scams going around: the week's biggest campaigns. */
  area: { title: string; households: number }[];
};

/** F2: what the lock screen shows: the newest urgent alert that still needs this person. */
export type LockView = {
  alert: AlertView | null;
  hold: HoldView | null;
  serverNow: string;
};

// ---------------- operator views ----------------

/** F3b: one campaign row on /campaigns. */
export type CampaignRow = {
  fingerprint: string;
  title: string;
  family: ScamFamily | null;
  households: number;
  last24h: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CampaignsView = {
  active: number;
  fastest: CampaignRow | null;
  householdsReached: number;
  rows: CampaignRow[];
  synthetic: number;
};

/** F4: where families overruled us, grouped by the stage that decided. */
export type DisagreementStage = {
  stage: string;
  checks: number;
  agreed: number;
  overruled: number;
  suggests: string;
};

export type DisagreementsView = {
  days: number;
  withAnswer: number;
  scamApproved: number;
  safeSaidScam: number;
  agreementPct: number | null;
  stages: DisagreementStage[];
  /** The checks a family approved after we called them a scam: signals only, never text. */
  mostImportant: { id: string; title: string; stage: string; phrases: string[]; by: string; at: string }[];
};

/** F7: our regex story against Claude's name for the trick, on the last AI test run. */
export type FamilyRow = {
  id: number;
  text: string;
  testLabel: string;
  ours: ScamFamily | null;
  claude: string | null;
  shown: string;
  outcome: "agree" | "close" | "differ" | "fallback" | "no_ai";
};

export type FamiliesView = {
  run: { model: string; createdAt: string } | null;
  agree: number;
  compared: number;
  differ: number;
  fallback: number;
  enumSize: number;
  unmatchedTestLabels: string[];
  rows: FamilyRow[];
  /** Real checks that carry Claude's name for the trick. */
  storedOnChecks: number;
};

/** F9b: one reported domain in the review queue. */
export type ReportView = {
  id: string;
  domain: string;
  reportedBy: string;
  otherReporters: number;
  seenIn: number;
  autoCheck: string;
  autoReason: string;
  status: "pending" | "blocked" | "rejected";
  protectedSite: boolean;
  createdAt: string;
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
