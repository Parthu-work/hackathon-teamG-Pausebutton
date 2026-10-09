// Prints a VAPID key pair for Web Push. Put the three lines in .env.local
// (local) and in the hosting provider's environment variables (production).
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=mailto:you@example.com`);
