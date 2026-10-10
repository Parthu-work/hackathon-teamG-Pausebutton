/** Accounts made before the name was asked for were stored as "Guest": that is no name. */
const PLACEHOLDER = "guest";

/**
 * The name to greet someone by: their first name ("Ramesh" from "Ramesh Rao"),
 * or the whole name with { full: true }. Null when there is none to use (blank,
 * or the old "Guest" placeholder), so the screen falls back to a plain greeting.
 * "Mr Rao" stays "Mr Rao": a title alone is not a first name.
 */
export function displayName(name: string | null | undefined, opts: { full?: boolean } = {}): string | null {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.toLowerCase() === PLACEHOLDER) return null;
  if (opts.full) return trimmed;
  const [first, second] = trimmed.split(" ");
  return /^(mr|mrs|ms|dr|shri|smt)\.?$/i.test(first) && second ? `${first} ${second}` : first;
}
