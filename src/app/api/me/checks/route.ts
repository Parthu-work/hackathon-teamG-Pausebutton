import { z } from "zod";
import { MAX_MESSAGE_CHARS } from "@/lib/check/pipeline";
import { createCheck, deleteHistory, listChecks } from "@/lib/server/checks";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireUser } from "@/lib/server/session";

export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return listChecks(db, user.id);
});

/**
 * D2 → D3: check a pasted message. The text is checked and then dropped.
 * F1: source "share" is a message forwarded from another app (senderLabel
 * names the app); F10: "voice" is one Mr Rao spoke instead of typing.
 */
export const POST = route(async (req) => {
  const { db, user } = await requireUser("rao");
  await rateLimit(db, req, "check", user.id); // before the checker can reach the Anthropic API
  const body = await readBody(
    req,
    z.object({
      text: z.string().trim().min(1, "Paste or pick a message first.").max(MAX_MESSAGE_CHARS),
      title: z.string().max(60).optional(),
      source: z.enum(["paste", "share", "voice"]).default("paste"),
      senderLabel: z.string().trim().max(40).optional(),
    }),
  );
  return createCheck(db, user, { text: body.text, title: body.title, source: body.source, senderLabel: body.senderLabel ?? null });
});

/** P3 "Delete my history". */
export const DELETE = route(async () => {
  const { db, user } = await requireUser("rao");
  return deleteHistory(db, user);
});
