/**
 * True on a hosted deployment (Vercel, Railway, Render, Fly.io, Cloud Run, or
 * DEPLOYED=1 anywhere else). A laptop, CI and the e2e server are not deployments.
 */
export function isDeployment() {
  const env = process.env;
  return !!(env.VERCEL || env.RAILWAY_ENVIRONMENT_NAME || env.RENDER || env.FLY_APP_NAME || env.K_SERVICE || env.DEPLOYED);
}

/** A secret from the environment. Deployments must set it; a laptop uses a fixed dev value. */
export function secretFromEnv(name: "SESSION_SECRET" | "FINGERPRINT_SECRET", devValue: string) {
  const value = process.env[name];
  if (value) return value;
  if (isDeployment()) throw new Error(`Set ${name} for deployments (see .env.example).`);
  return devValue;
}
