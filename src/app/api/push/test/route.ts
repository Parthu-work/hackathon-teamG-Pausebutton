import { route } from "@/lib/server/http";
import { pushToUsers } from "@/lib/server/push";
import { requireAnyUser } from "@/lib/server/session";

/** "Send me a test alert": a real push to this person's phones, to prove alerts arrive when the app is closed. */
export const POST = route(async () => {
  const { db, user } = await requireAnyUser();
  const { sent } = await pushToUsers(db, [user.id], {
    title: "Test alert from Pause Button",
    body: "This is how a scam alert reaches you, even with the app closed.",
    url: "/family",
    tag: "test-alert",
    urgent: true,
  });
  return { sent };
});
