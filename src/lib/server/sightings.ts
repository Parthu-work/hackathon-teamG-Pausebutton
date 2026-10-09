import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { CAMPAIGN_HOURS } from "@/lib/check/config";
import type { ScamFamily } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { CampaignRow, CampaignView, CampaignsView } from "@/lib/views";

// F3 · Campaign radar. Every scam or suspicious check leaves one sighting:
// the message fingerprint and a household key, nothing else. Two households
// that get the same message make the same fingerprint, so "47 other families
// got this today" needs no message text at all.

export type NewSighting = { fingerprint: string; householdKey: string; family: ScamFamily | null; title: string; domain: string | null; synthetic?: boolean; seenAt?: Date };

export async function recordSighting(db: Db, s: NewSighting) {
  await db.insert(schema.sightings).values({ ...s, synthetic: s.synthetic ?? false, seenAt: s.seenAt ?? new Date() });
}

const since = (hours: number) => new Date(Date.now() - hours * 3600_000);

/** For a verdict screen: how many OTHER households got this message in the last 24 hours. */
export async function campaignFor(db: Db, fingerprint: string, householdKey: string): Promise<CampaignView | null> {
  const rows = await db.query.sightings.findMany({ where: eq(schema.sightings.fingerprint, fingerprint) });
  if (!rows.length) return null;
  const others = rows.filter((r) => r.householdKey !== householdKey);
  const recent = new Set(others.filter((r) => r.seenAt.getTime() >= since(CAMPAIGN_HOURS).getTime()).map((r) => r.householdKey));
  if (recent.size < 2) return null;
  const firstSeenAt = rows.reduce((min, r) => (r.seenAt < min ? r.seenAt : min), rows[0].seenAt);
  return { households: recent.size, firstSeenAt: firstSeenAt.toISOString(), spreading: recent.size >= 10 };
}

/** F3b · /campaigns: every fingerprint seen by two or more households, last 24 hours first. */
export async function campaignsView(db: Db): Promise<CampaignsView> {
  const rows = await db.query.sightings.findMany({ orderBy: desc(schema.sightings.seenAt), limit: 5000 });
  const cutoff = since(CAMPAIGN_HOURS).getTime();
  const byPrint = new Map<string, typeof rows>();
  for (const r of rows) byPrint.set(r.fingerprint, [...(byPrint.get(r.fingerprint) ?? []), r]);
  const all: CampaignRow[] = [];
  for (const [fingerprint, list] of byPrint) {
    const households = new Set(list.map((r) => r.householdKey));
    if (households.size < 2) continue;
    const recent = new Set(list.filter((r) => r.seenAt.getTime() >= cutoff).map((r) => r.householdKey));
    const times = list.map((r) => r.seenAt.getTime());
    all.push({
      fingerprint,
      title: list[0].title,
      family: list[0].family,
      households: households.size,
      last24h: recent.size,
      firstSeenAt: new Date(Math.min(...times)).toISOString(),
      lastSeenAt: new Date(Math.max(...times)).toISOString(),
    });
  }
  all.sort((a, b) => b.households - a.households || b.last24h - a.last24h);
  const fastest = all.length ? all.reduce((best, r) => (r.last24h > best.last24h ? r : best), all[0]) : null;
  return {
    active: all.length,
    fastest,
    householdsReached: all.reduce((n, r) => n + r.households, 0),
    rows: all,
    synthetic: rows.filter((r) => r.synthetic).length,
  };
}

/** F12: "Scams going around your area": the week's biggest campaigns, by households. */
export async function areaCampaigns(db: Db, limit = 2): Promise<{ title: string; households: number }[]> {
  const rows = await db
    .select({ title: schema.sightings.title, fingerprint: schema.sightings.fingerprint, households: sql<number>`count(distinct ${schema.sightings.householdKey})` })
    .from(schema.sightings)
    .where(gte(schema.sightings.seenAt, since(7 * 24)))
    .groupBy(schema.sightings.fingerprint, schema.sightings.title)
    .orderBy(desc(sql`count(distinct ${schema.sightings.householdKey})`))
    .limit(limit);
  return rows.map((r) => ({ title: r.title, households: Number(r.households) })).filter((r) => r.households >= 2);
}

/** How many checks (sightings) a reported domain was seen in (F9b "Seen in"). */
export async function sightingsOfDomain(db: Db, domain: string) {
  const rows = await db.query.sightings.findMany({ where: eq(schema.sightings.domain, domain) });
  return rows.length;
}

/** Distinct households that met one of the given domains in the last week (F9a "11 families protected"). */
export async function householdsThatMet(db: Db, domains: string[]) {
  if (!domains.length) return 0;
  const rows = await db.query.sightings.findMany({ where: and(gte(schema.sightings.seenAt, since(7 * 24)), ne(schema.sightings.domain, "")) });
  return new Set(rows.filter((r) => r.domain && domains.includes(r.domain)).map((r) => r.householdKey)).size;
}

export async function clearSyntheticSightings(db: Db) {
  await db.delete(schema.sightings).where(eq(schema.sightings.synthetic, true));
}
