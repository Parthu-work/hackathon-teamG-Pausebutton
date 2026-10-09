import { and, eq, gte, inArray } from "drizzle-orm";
import { finalVerdict } from "@/lib/check/final";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { LedgerView } from "@/lib/views";
import { userNames } from "./holds";
import { callNameOf } from "./people";
import { areaCampaigns } from "./sightings";

type User = typeof schema.users.$inferSelect;

// F12 · The household ledger: what the family stopped this month, in rupees.
// Everything here comes from holds and checks the app already keeps.

export async function familyLedger(db: Db, me: User): Promise<LedgerView> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const links = await db.query.links.findMany({ where: and(eq(schema.links.familyId, me.id), eq(schema.links.status, "linked")) });
  const empty: LedgerView = { month, paused: 0, heldAmount: 0, checked: 0, fine: 0, stopped: [], fastest: null, area: await areaCampaigns(db) };
  if (!links.length) return empty;
  const ownerIds = links.map((l) => l.protectedId);
  const owners = await db.query.users.findMany({ where: inArray(schema.users.id, ownerIds) });
  const [holds, checks] = await Promise.all([
    db.query.holds.findMany({ where: and(inArray(schema.holds.userId, ownerIds), gte(schema.holds.createdAt, monthStart)) }),
    db.query.checks.findMany({ where: and(inArray(schema.checks.userId, ownerIds), gte(schema.checks.createdAt, monthStart)) }),
  ]);
  const blocked = holds.filter((h) => h.status === "blocked" && h.decidedAt);
  const names = await userNames(db, blocked.map((h) => h.decidedById ?? ""));
  const titles = new Map(checks.map((c) => [c.id, c.title]));
  const stopped = blocked
    .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())
    .map((h) => {
      const owner = owners.find((o) => o.id === h.userId);
      const relation = links.find((l) => l.protectedId === h.userId)?.relation;
      return {
        holdId: h.id,
        checkId: h.checkId,
        title: titles.get(h.checkId) ?? "Payment",
        amount: h.amount,
        by: h.decidedById ? names[h.decidedById] ?? "Family" : "Family",
        at: h.decidedAt!.toISOString(),
        owner: owner ? callNameOf(owner, relation) : "",
      };
    });
  const quickest = blocked.reduce<(typeof blocked)[number] | null>((best, h) => {
    const ms = h.decidedAt!.getTime() - h.createdAt.getTime();
    return !best || ms < best.decidedAt!.getTime() - best.createdAt.getTime() ? h : best;
  }, null);
  return {
    month,
    paused: holds.length,
    heldAmount: blocked.reduce((n, h) => n + h.amount, 0),
    checked: checks.length,
    fine: checks.filter((c) => finalVerdict(c.verdict, c.familyVerdict) === "SAFE").length,
    stopped,
    fastest: quickest
      ? { ms: quickest.decidedAt!.getTime() - quickest.createdAt.getTime(), title: titles.get(quickest.checkId) ?? "Payment", by: quickest.decidedById ? names[quickest.decidedById] ?? "Family" : "Family" }
      : null,
    area: empty.area,
  };
}
