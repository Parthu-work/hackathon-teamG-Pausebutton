import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { campaignsView } from "@/lib/server/sightings";

/** F3b · Operator: campaigns grouped by fingerprint, last 24 hours. */
export const GET = route(async () => campaignsView(await getDb()));
