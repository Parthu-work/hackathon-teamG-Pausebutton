import type { LinkStatus, SignalType } from "./types";

// Soft-rule points. They add up to 100 so the rules part of the spam
// percentage reads directly as a percentage.
export const SIGNAL_POINTS: Record<SignalType, number> = {
  secrecy: 25,
  payment: 25,
  authority: 15,
  fear: 15,
};

export const LINK_POINTS: Record<LinkStatus, number> = {
  known: 0,
  unknown: 10,
  risky: 20,
  lookalike: 20,
  blocked: 20,
};

// Spam percentage bands. Tune these on /tests.
export const SCAM_AT = 70;
export const SUSPICIOUS_AT = 30;

// Payment holds and invites.
export const HOLD_MINUTES = 10;
export const INVITE_HOURS = 24;

// Text of scam/suspicious messages is kept this long so alerted family can read it.
export const SHARE_TEXT_HOURS = 24;

// The AI reader is only asked about messages the fast path is unsure of.
export const AI_TIMEOUT_MS = 2500;
export const AI_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;
export type AiModelKey = keyof typeof AI_MODELS;
