import type { CapacitorConfig } from "@capacitor/cli";

// The Android app (android/) is a Capacitor shell around the hosted web app:
// its WebView loads server.url, so Next's server routes and server components
// keep working and nothing is bundled twice. webDir holds only a placeholder
// page (capacitor/www), shown for a moment before the site loads.
// PB_HOST: the deployed site, as for the Gradle build (CI sets it).
const host = (process.env.PB_HOST || "https://hackathon-teamg-pausebutton-production.up.railway.app").replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "ai.apty.pausebutton",
  appName: "Pause Button",
  webDir: "capacitor/www",
  server: {
    url: host,
    androidScheme: "https",
    // A debug build may point at a laptop (http://10.0.2.2:3000); release builds never allow plain http.
    cleartext: process.env.PB_CLEARTEXT === "1",
  },
  android: {
    path: "android",
    allowMixedContent: false,
    backgroundColor: "#14202B",
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
