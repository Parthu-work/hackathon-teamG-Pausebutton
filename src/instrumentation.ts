import type { Instrumentation } from "next";

// Runs once when a server instance starts, before it takes requests.

/** Refuses to start a misconfigured deployment, naming every problem at once. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv, describeEnvErrors } = await import("@/lib/server/env");
  const { log } = await import("@/lib/server/log");
  const { errors, warnings } = checkEnv();
  for (const warning of warnings) log.warn("config_warning", { warning });
  if (errors.length) {
    log.error("config_invalid", { problems: errors.length, variables: errors.map((e) => e.split(" ")[0]).join(",") }); // the thrown error says why
    throw new Error(describeEnvErrors(errors));
  }
}

/** Server errors outside the API routes (those log their own, with a ref): pages and server components. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { errorFields, log } = await import("@/lib/server/log");
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  log.error("request_error", {
    digest,
    method: request.method,
    path: request.path.split("?")[0], // no query string
    routePath: context.routePath,
    routeType: context.routeType,
    ...errorFields(error),
  });
};
