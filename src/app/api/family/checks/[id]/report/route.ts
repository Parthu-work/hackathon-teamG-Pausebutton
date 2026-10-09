import { route } from "@/lib/server/http";
import { reportDomain } from "@/lib/server/reports";
import { requireUser } from "@/lib/server/session";

/** F9a · "Report this as a fake site": the link in the message this member was alerted about. */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  return reportDomain(db, user, id);
});
