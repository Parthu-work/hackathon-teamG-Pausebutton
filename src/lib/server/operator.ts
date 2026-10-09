import crypto from "node:crypto";
import { HttpError } from "./session";

/**
 * The operator tools (/demo, /tests runs, "Reset demo data") are open on a
 * laptop. Before a public deploy set OPERATOR_KEY: these routes then need it
 * in the x-operator-key header.
 */
export function requireOperator(req: Request) {
  const key = process.env.OPERATOR_KEY;
  if (!key) return;
  const given = Buffer.from(req.headers.get("x-operator-key") ?? "");
  const expected = Buffer.from(key);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(401, "This needs the operator key.");
  }
}
