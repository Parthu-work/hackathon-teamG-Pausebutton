"use client";

import { api } from "./api";
import { forgetMessages } from "./messages";
import { dropPushSubscription } from "./push";

/**
 * Deletes the signed-in person's account (docs/retention.md), then what this
 * phone still holds for them: message texts and its push subscription. The
 * server clears the session cookie. Throws ApiError 409 while a payment is on hold.
 */
export async function deleteMyAccount(app: "rao" | "family") {
  await api(app === "rao" ? "/api/me/account" : "/api/family/account", { method: "DELETE" });
  forgetMessages();
  await dropPushSubscription();
}
