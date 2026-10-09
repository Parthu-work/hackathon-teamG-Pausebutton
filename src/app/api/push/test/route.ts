import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { pushToUsers } from "@/lib/server/push";
import { requireAnyUser } from "@/lib/server/session";

/** "Send me a test alert": a real push to this person's phones, to prove alerts arrive when the app is closed. */
export const POST = route(async (req) => {
  const { app } = await readBody(req, z.object({ app: z.enum(["family", "rao"]).default("family") }));
  const { db, user } = await requireAnyUser();
  const { sent, results } = await pushToUsers(db, [user.id], {
    title: "Test alert from Pause Button",
    body: "This is how an alert reaches you, even with the app closed.",
    url: app === "family" ? "/family" : "/",
    tag: "test-alert",
    urgent: true,
    app,
  });
  return { sent, status: results[0]?.status ?? "not_configured" };
});
