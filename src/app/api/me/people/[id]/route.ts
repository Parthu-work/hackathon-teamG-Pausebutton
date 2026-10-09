import { readBody, route } from "@/lib/server/http";
import { removePerson, updatePerson } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";
import { personBody } from "@/lib/server/schemas";

export const PATCH = route(async (req, { id }) => {
  const { db, user } = await requireUser("rao");
  return updatePerson(db, user, id, await readBody(req, personBody));
});

export const DELETE = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  await removePerson(db, user, id);
});
