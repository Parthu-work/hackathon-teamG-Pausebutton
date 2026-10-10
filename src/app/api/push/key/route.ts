import { route } from "@/lib/server/http";
import { fcmEnabled, pushPublicKey } from "@/lib/server/push";

/**
 * The VAPID public key browsers subscribe with (null without Web Push), and
 * whether the server can reach the Android app through FCM.
 */
export const GET = route(async () => ({ publicKey: pushPublicKey(), fcm: fcmEnabled() }));
