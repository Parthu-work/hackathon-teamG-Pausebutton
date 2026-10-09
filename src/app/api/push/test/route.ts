import { route } from "@/lib/server/http";
import { pushToUsers } from "@/lib/server/push";
import { requireAnyUser } from "@/lib/server/session";

/** "Send me a test alert": a real push to this person's phones, to prove alerts arrive when the app is closed. */
export const POST = route(async () => {
  const { db, user } = await requireAnyUser();
  const { sent } = await pushToUsers(
    db,
    [user.id],
    {
      title: "Test alert from Pause Button",
      body: "This is how a scam alert reaches you, even with the app closed.",
      url: user.role === "protected" ? "/" : "/family",
      tag: "test-alert",
      urgent: true,
      kind: "test",
      at: new Date().toISOString(),
    },
    // The person asked for it themselves, so their Notifications setting does not apply; nor does "only once".
    { force: true },
  );
  return { sent };
});
