import { createPrivateKey } from "node:crypto";
import { formatPhone } from "@/lib/phone";
import { isDeployment } from "./secrets";

// Configuration checked once, at server start (src/instrumentation.ts) and at
// the start of the Vercel build (`pnpm env:check`). Every problem is reported
// together, so a deploy is fixed in one pass, not one variable per attempt.
// "Deployed" is secrets.ts isDeployment(): Vercel, Railway, Render, Fly.io,
// Cloud Run or DEPLOYED=1. A laptop or CI needs nothing set.

type Env = Record<string, string | undefined>;
export type EnvReport = { errors: string[]; warnings: string[] };

const set = (env: Env, name: string) => !!env[name]?.trim();

/** Needed on every deployment, with what each one is for. */
const REQUIRED_DEPLOYED: [string, string][] = [
  ["DATABASE_URL", "Postgres; the embedded database only works on a laptop"],
  ["SESSION_SECRET", "signs sign-in sessions"],
  ["FINGERPRINT_SECRET", "keys the message fingerprints; set it once and never change it"],
  ["OPERATOR_KEY", "locks the operator pages on a public URL"],
];

const SECRETS = ["SESSION_SECRET", "FINGERPRINT_SECRET", "OPERATOR_KEY"];
const MIN_SECRET = 32;
const DEMO_PHONES = ["DEMO_RAO_PHONE", "DEMO_MOM_PHONE", "DEMO_ARJUN_PHONE", "DEMO_MEERA_PHONE"];

/** What FCM sending needs from the Firebase service account. */
export type ServiceAccount = { project_id: string; client_email: string; private_key: string };

/**
 * FCM_SERVICE_ACCOUNT: the Firebase service account JSON file's content, as
 * is or base64-encoded (easier to paste into a host's settings). Null when it
 * is not set or is not such a file.
 */
export function readServiceAccount(value: string | undefined): ServiceAccount | null {
  const raw = value?.trim();
  if (!raw) return null;
  for (const text of [raw, Buffer.from(raw, "base64").toString("utf8")]) {
    let json: Partial<Record<keyof ServiceAccount, unknown>>;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const { project_id, client_email, private_key } = json ?? {};
    if ([project_id, client_email, private_key].every((v) => typeof v === "string" && v.trim())) {
      return { project_id, client_email, private_key } as ServiceAccount;
    }
    return null;
  }
  return null;
}

export function checkEnv(env: Env = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const deployed = isDeployment(env);

  if (deployed) {
    for (const [name, why] of REQUIRED_DEPLOYED) if (!set(env, name)) errors.push(`${name} is not set (${why}).`);
    for (const name of SECRETS) {
      if (set(env, name) && env[name]!.trim().length < MIN_SECRET) warnings.push(`${name} is shorter than ${MIN_SECRET} characters; use a long random value (openssl rand -base64 32).`);
    }
  }

  if (set(env, "DATABASE_URL") && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL!.trim())) {
    errors.push("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
  }

  // Half a key pair silently turns push off; a bad subject fails on the first alert.
  const vapid = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((n) => set(env, n));
  if (vapid.length === 1) {
    const missing = vapid[0] === "VAPID_PUBLIC_KEY" ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY";
    errors.push(`${vapid[0]} is set but ${missing} is not: set both (pnpm push:keys) or neither.`);
  }
  if (vapid.length === 2 && set(env, "VAPID_SUBJECT") && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT!.trim())) {
    errors.push("VAPID_SUBJECT must start with mailto: or https://.");
  }

  // FCM (the Android app): a broken service account is caught now, not on the first alert.
  if (set(env, "FCM_SERVICE_ACCOUNT")) {
    const account = readServiceAccount(env.FCM_SERVICE_ACCOUNT);
    if (!account) errors.push("FCM_SERVICE_ACCOUNT must be the Firebase service account JSON (as is or base64) with project_id, client_email and private_key.");
    else if (!isPrivateKey(account.private_key)) errors.push("FCM_SERVICE_ACCOUNT's private_key is not a PEM private key: paste the whole JSON file unchanged.");
  }
  if (deployed && vapid.length === 0 && !set(env, "FCM_SERVICE_ACCOUNT")) {
    warnings.push("Neither VAPID keys (browsers, iPhone) nor FCM_SERVICE_ACCOUNT (the Android app) is set: alerts reach phones only while the app is open.");
  }

  // A number that does not parse falls back to a placeholder that may belong to a stranger.
  for (const name of DEMO_PHONES) {
    if (set(env, name) && !formatPhone(env[name]!)) errors.push(`${name} is not a 10-digit Indian mobile number.`);
  }

  if (!set(env, "ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_API_KEY is not set: checks run on rules and the fast-gate model only.");

  return { errors, warnings };
}

function isPrivateKey(pem: string) {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
}

/** One message naming every problem, for a thrown error or a failed build. */
export function describeEnvErrors(errors: string[]) {
  return `Pause Button is not configured: ${errors.length} problem${errors.length === 1 ? "" : "s"} (see .env.example).\n${errors.map((e) => `  - ${e}`).join("\n")}`;
}
