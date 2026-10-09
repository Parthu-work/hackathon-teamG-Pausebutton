// Structured server logs: one JSON object per line, so Vercel's log search
// can filter on `event`, `status` or `ref`. Message text never goes in a log.
// Fields take only short scalars (ids, counts, codes), and an error is reduced
// to its name, code, first message line and stack frames: a failed query's
// "params:" (which can hold a message) and a database error's `detail` are dropped.

type Scalar = string | number | boolean | null | undefined;
export type LogFields = Record<string, Scalar>;
type Level = "info" | "warn" | "error";

const MAX_FIELD = 300;

function write(level: Level, event: string, fields: LogFields = {}) {
  const clean: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    clean[k] = typeof v === "string" && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…` : v;
  }
  const line = JSON.stringify({ level, time: new Date().toISOString(), event, ...clean });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

/** The first line of an error message, without the bound parameters of a failed query. */
function safeMessage(message: string) {
  return message.split(/\n|\bparams:/)[0].trim();
}

/** What a log may say about an error. */
export function errorFields(error: unknown, prefix = "error"): LogFields {
  if (!(error instanceof Error)) return { [`${prefix}`]: typeof error };
  const e = error as Error & { code?: unknown; cause?: unknown };
  const frames = (e.stack ?? "")
    .split("\n")
    .filter((l) => l.startsWith("    at "))
    .slice(0, 8)
    .map((l) => l.trim())
    .join(" | ");
  const fields: LogFields = {
    [`${prefix}Name`]: e.name,
    [`${prefix}Code`]: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined,
    [`${prefix}Message`]: safeMessage(e.message),
    [`${prefix}Stack`]: frames || undefined,
  };
  if (e.cause instanceof Error) {
    const c = e.cause as Error & { code?: unknown };
    fields[`${prefix}CauseName`] = c.name;
    fields[`${prefix}CauseCode`] = typeof c.code === "string" || typeof c.code === "number" ? c.code : undefined;
    fields[`${prefix}CauseMessage`] = safeMessage(c.message);
  }
  return fields;
}
