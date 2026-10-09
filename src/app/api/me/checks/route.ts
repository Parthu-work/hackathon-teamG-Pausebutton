import { z } from "zod";
import { MAX_MESSAGE_CHARS } from "@/lib/check/pipeline";
import { createCheck, deleteHistory, listChecks } from "@/lib/server/checks";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return listChecks(db, user.id);
});

/** D2 → D3: check a pasted message. The text is checked and then dropped. */
export const POST = route(async (req) => {
  const { db, user } = await requireUser("rao");
  const body = await readBody(
    req,
    z.object({
      text: z.string().trim().min(1, "Paste or pick a message first.").max(MAX_MESSAGE_CHARS),
      title: z.string().max(60).optional(),
    }),
  );
  return createCheck(db, user, { text: body.text, title: body.title, source: "paste" });
});

/** P3 "Delete my history". */
export const DELETE = route(async () => {
  const { db, user } = await requireUser("rao");
  return deleteHistory(db, user);
});
