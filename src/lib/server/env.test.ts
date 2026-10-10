import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, describeEnvErrors, readServiceAccount } from "./env";

const LONG = "x".repeat(40);
const deployed = {
  VERCEL: "1",
  DATABASE_URL: "postgresql://u:p@host/db",
  SESSION_SECRET: LONG,
  FINGERPRINT_SECRET: LONG,
  OPERATOR_KEY: LONG,
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  ANTHROPIC_API_KEY: "sk",
};

describe("configuration check", () => {
  it("asks nothing of a laptop or CI", () => {
    expect(checkEnv({}).errors).toEqual([]);
  });

  it("passes a fully configured deployment with no warnings", () => {
    expect(checkEnv(deployed)).toEqual({ errors: [], warnings: [] });
  });

  it("names every missing deployment variable at once, not the first", () => {
    const { errors } = checkEnv({ VERCEL: "1" });
    for (const name of ["DATABASE_URL", "SESSION_SECRET", "FINGERPRINT_SECRET", "OPERATOR_KEY"]) {
      expect(errors.some((e) => e.startsWith(name))).toBe(true);
    }
    expect(errors).toHaveLength(4);
    expect(describeEnvErrors(errors)).toContain("4 problems");
  });

  it("applies the deployment rules on every host isDeployment() knows, not only Vercel", () => {
    for (const host of [{ RAILWAY_ENVIRONMENT_NAME: "production" }, { RENDER: "true" }, { DEPLOYED: "1" }]) {
      expect(checkEnv(host).errors).toHaveLength(4);
    }
  });

  it("treats a blank value as missing", () => {
    expect(checkEnv({ ...deployed, OPERATOR_KEY: "  " }).errors).toEqual([expect.stringMatching(/^OPERATOR_KEY is not set/)]);
  });

  it("catches values that would fail later, anywhere", () => {
    const { errors } = checkEnv({
      DATABASE_URL: "mysql://nope",
      VAPID_PUBLIC_KEY: "pub",
      DEMO_ARJUN_PHONE: "12345",
    });
    expect(errors).toEqual([
      "DATABASE_URL must be a postgres:// or postgresql:// connection string.",
      "VAPID_PUBLIC_KEY is set but VAPID_PRIVATE_KEY is not: set both (pnpm push:keys) or neither.",
      "DEMO_ARJUN_PHONE is not a 10-digit Indian mobile number.",
    ]);
    expect(checkEnv({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "you@example.com" }).errors).toEqual([
      "VAPID_SUBJECT must start with mailto: or https://.",
    ]);
    expect(checkEnv({ DEMO_RAO_PHONE: "+91 98765 43210" }).errors).toEqual([]);
  });

  it("warns, without failing, about short secrets and missing push or AI keys", () => {
    const { errors, warnings } = checkEnv({ ...deployed, SESSION_SECRET: "short", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", ANTHROPIC_API_KEY: "" });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(3);
    expect(warnings).toContain(
      "Neither VAPID keys (browsers, iPhone) nor FCM_SERVICE_ACCOUNT (the Android app) is set: alerts reach phones only while the app is open.",
    );
  });
});

describe("FCM service account", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const account = { type: "service_account", project_id: "pause-test", client_email: "push@pause-test.iam.gserviceaccount.com", private_key: privateKey };
  const json = JSON.stringify(account);

  it("reads the service account JSON as is or base64-encoded", () => {
    const want = { project_id: "pause-test", client_email: account.client_email, private_key: privateKey };
    expect(readServiceAccount(json)).toEqual(want);
    expect(readServiceAccount(Buffer.from(json).toString("base64"))).toEqual(want);
    expect(readServiceAccount(undefined)).toBeNull();
    expect(readServiceAccount("  ")).toBeNull();
  });

  it("accepts a good one, alone or next to the VAPID keys, and it silences the no-push warning", () => {
    expect(checkEnv({ ...deployed, FCM_SERVICE_ACCOUNT: json })).toEqual({ errors: [], warnings: [] });
    expect(checkEnv({ ...deployed, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", FCM_SERVICE_ACCOUNT: Buffer.from(json).toString("base64") })).toEqual({ errors: [], warnings: [] });
  });

  it("refuses one that is not the service account file, anywhere", () => {
    const problem = "FCM_SERVICE_ACCOUNT must be the Firebase service account JSON (as is or base64) with project_id, client_email and private_key.";
    for (const value of ["not json", "{}", JSON.stringify({ ...account, client_email: "" }), Buffer.from(JSON.stringify({ project_id: "p" })).toString("base64")]) {
      expect(checkEnv({ FCM_SERVICE_ACCOUNT: value }).errors).toEqual([problem]);
    }
    expect(checkEnv({ FCM_SERVICE_ACCOUNT: JSON.stringify({ ...account, private_key: "-----BEGIN PRIVATE KEY-----\\nmangled" }) }).errors).toEqual([
      "FCM_SERVICE_ACCOUNT's private_key is not a PEM private key: paste the whole JSON file unchanged.",
    ]);
  });
});
