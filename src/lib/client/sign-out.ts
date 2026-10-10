"use client";

import { post } from "./api";
import { currentPushEndpoint, dropPushSubscription } from "./push";

/**
 * Signs this phone out of one app and stops its alerts: the server forgets
 * this phone's push registration for the person (a browser's endpoint, or in
 * the Android app "fcm:<token>"), then the phone drops it. Whoever signs in
 * next registers the phone afresh, without being asked again.
 */
export async function signOut(app: "rao" | "family") {
  const pushEndpoint = await currentPushEndpoint();
  await post("/api/auth/sign-out", { app, pushEndpoint });
  await dropPushSubscription();
}
