import { readBody, route } from "@/lib/server/http";
import { addPerson, listPeople } from "@/lib/server/people";
import { personBody } from "@/lib/server/schemas";
import { requireUser } from "@/lib/server/session";

export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return listPeople(db, user.id);
});

export const POST = route(async (req) => {
  const { db, user } = await requireUser("rao");
  return addPerson(db, user, await readBody(req, personBody));
});
