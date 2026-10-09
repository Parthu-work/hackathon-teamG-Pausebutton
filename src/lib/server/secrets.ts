/** A secret from the environment. Deployments must set it; a laptop uses a fixed dev value. */
export function secretFromEnv(name: "SESSION_SECRET" | "FINGERPRINT_SECRET", devValue: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.VERCEL) throw new Error(`Set ${name} for deployments (see .env.example).`);
  return devValue;
}
