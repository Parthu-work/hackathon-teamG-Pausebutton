import { route } from "@/lib/server/http";
import { pushPublicKey } from "@/lib/server/push";

/** The VAPID public key phones subscribe with; null when push is not configured. */
export const GET = route(async () => ({ publicKey: pushPublicKey() }));
