import { and, desc, eq } from "drizzle-orm";
import { classifyDomain, isOfficialDomain, OFFICIAL_COUNT } from "@/lib/check/links";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { ReportableLink, ReportView } from "@/lib/views";
import { logEvent } from "./events";
import { assertLinked } from "./holds";
import { HttpError } from "./session";
import { householdsThatMet, sightingsOfDomain } from "./sightings";

// F9 · Family-reported domains. A family member who opened an alert can
// report the link in it. A reviewer blocks or rejects it on /reports; blocked
// domains join the live blocklist read by the checker, with no redeploy.
// Official sites (links.ts OFFICIAL) are refused before anyone sees them.

type User = typeof schema.users.$inferSelect;
type Check = typeof schema.checks.$inferSelect;

let cache: { at: number; domains: string[] } | null = null;
const CACHE_MS = 15_000;

/** Domains a reviewer blocked. Cached briefly: it is read on every check. */
export async function liveBlockedDomains(db: Db): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.domains;
  const rows = await db.query.reportedDomains.findMany({ where: eq(schema.reportedDomains.status, "blocked") });
  cache = { at: Date.now(), domains: [...new Set(rows.map((r) => r.domain))] };
  return cache.domains;
}

export function forgetBlocklistCache() {
  cache = null;
}

export const cleanDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];

/** What the checker already says, in the review queue's words. */
function autoCheckOf(domain: string): { autoCheck: string; autoReason: string } {
  if (isOfficialDomain(domain)) return { autoCheck: "official", autoReason: "Real bank · protected" };
  const c = classifyDomain(domain);
  if (c.status === "lookalike") {
    const brand = c.reason.match(/“([^”]+)”/)?.[1] ?? c.reason.match(/looks like ([\w.-]+)/)?.[1]?.split(".")[0]?.toUpperCase();
    return { autoCheck: "lookalike", autoReason: brand ? `Looks like ${brand}` : "Looks like a known brand" };
  }
  if (c.status === "risky") return { autoCheck: "risky", autoReason: "Odd domain ending" };
  if (c.status === "blocked") return { autoCheck: "blocked", autoReason: "Already on the blocklist" };
  return { autoCheck: "unknown", autoReason: "Unknown site" };
}

/** F9a · "Report this as a fake site": two taps from the alert. */
export async function reportDomain(db: Db, member: User, checkId: string) {
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId) });
  if (!check) throw new HttpError(404, "That message was not found.");
  await assertLinked(db, member, check.userId);
  const alerted = await db.query.alerts.findFirst({ where: and(eq(schema.alerts.checkId, checkId), eq(schema.alerts.recipientId, member.id)) });
  if (!alerted) throw new HttpError(403, "Only people alerted about this message can report its link.");
  if (!check.link || check.link.status === "known") throw new HttpError(400, "This message has no link to report.");
  const domain = cleanDomain(check.link.domain);
  if (isOfficialDomain(domain)) throw new HttpError(400, "That is a real bank or official site. It can never be blocked.");
  const mine = await db.query.reportedDomains.findFirst({
    where: and(eq(schema.reportedDomains.domain, domain), eq(schema.reportedDomains.reportedById, member.id)),
  });
  if (mine) return { id: mine.id, status: mine.status };
  const [row] = await db
    .insert(schema.reportedDomains)
    .values({ domain, reportedById: member.id, reportedByName: member.name, checkId, ...autoCheckOf(domain) })
    .returning();
  await logEvent(db, check.userId, member.name, "domain_reported", `${member.name} reported ${domain} as a fake site`);
  return { id: row.id, status: row.status };
}

/** The link in a message as the family member sees it on the report screen. */
export async function reportableFor(db: Db, check: Check, member: User): Promise<ReportableLink | null> {
  if (!check.link || check.link.status === "known") return null;
  const domain = cleanDomain(check.link.domain);
  const rows = await db.query.reportedDomains.findMany({ where: eq(schema.reportedDomains.domain, domain) });
  const mine = rows.find((r) => r.reportedById === member.id);
  const reported: ReportableLink["reported"] = rows.some((r) => r.status === "blocked") ? "blocked" : mine ? mine.status : "none";
  const blocked = await liveBlockedDomains(db);
  return {
    domain,
    status: check.link.status,
    reason: check.link.reason,
    protectedSite: isOfficialDomain(domain),
    reported,
    familiesProtected: await householdsThatMet(db, blocked),
  };
}

/** F9b · the review queue, waiting first. */
export async function listReports(db: Db): Promise<{ waiting: number; rows: ReportView[]; officialCount: number }> {
  const rows = await db.query.reportedDomains.findMany({ orderBy: desc(schema.reportedDomains.createdAt), limit: 200 });
  const byDomain = new Map<string, typeof rows>();
  for (const r of rows) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);
  const out: ReportView[] = [];
  for (const [domain, list] of byDomain) {
    const first = list[list.length - 1]; // the earliest report
    const status = list.some((r) => r.status === "blocked") ? "blocked" : list.every((r) => r.status === "rejected") ? "rejected" : "pending";
    out.push({
      id: first.id,
      domain,
      reportedBy: first.reportedByName,
      otherReporters: list.length - 1,
      seenIn: await sightingsOfDomain(db, domain),
      autoCheck: first.autoCheck,
      autoReason: first.autoReason,
      status,
      protectedSite: isOfficialDomain(domain),
      createdAt: first.createdAt.toISOString(),
    });
  }
  const order = { pending: 0, blocked: 1, rejected: 2 };
  out.sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  return { waiting: out.filter((r) => r.status === "pending").length, rows: out, officialCount: OFFICIAL_COUNT };
}

/**
 * A reviewer blocks or rejects every report of a domain. Official sites cannot
 * be blocked. "unblock" takes a domain blocked in error off the live blocklist
 * (its reports end up rejected, as if the reviewer had rejected them).
 */
export async function reviewDomain(db: Db, reportId: string, decision: "block" | "reject" | "unblock") {
  const row = await db.query.reportedDomains.findFirst({ where: eq(schema.reportedDomains.id, reportId) });
  if (!row) throw new HttpError(404, "That report was not found.");
  if (decision === "block" && isOfficialDomain(row.domain)) throw new HttpError(400, "Real banks can never be blocked.");
  if (decision === "unblock") {
    const blocked = await db.query.reportedDomains.findFirst({
      where: and(eq(schema.reportedDomains.domain, row.domain), eq(schema.reportedDomains.status, "blocked")),
    });
    if (!blocked) throw new HttpError(400, "That domain is not blocked.");
  }
  const status = decision === "block" ? "blocked" : "rejected";
  await db.update(schema.reportedDomains).set({ status, reviewedAt: new Date() }).where(eq(schema.reportedDomains.domain, row.domain));
  forgetBlocklistCache();
  if (decision === "unblock") return { domain: row.domain, status: "unblocked" as const };
  return { domain: row.domain, status };
}

export async function clearSyntheticReports(db: Db) {
  await db.delete(schema.reportedDomains).where(eq(schema.reportedDomains.synthetic, true));
  forgetBlocklistCache();
}

/** Demo seed rows for the review queue (synthetic reporters; Arjun's and Meera's own rows use their ids). */
export async function seedReport(db: Db, r: { domain: string; reportedById?: string | null; reportedByName: string; status?: "pending" | "blocked" | "rejected"; daysAgo?: number }) {
  const domain = cleanDomain(r.domain);
  const auto = autoCheckOf(domain);
  const status = r.status ?? (auto.autoCheck === "official" ? "rejected" : "pending");
  await db.insert(schema.reportedDomains).values({
    domain,
    reportedById: r.reportedById ?? null,
    reportedByName: r.reportedByName,
    status,
    ...auto,
    synthetic: true,
    reviewedAt: status === "pending" ? null : new Date(),
    createdAt: new Date(Date.now() - (r.daysAgo ?? 0) * 86400_000),
  });
  forgetBlocklistCache();
}
