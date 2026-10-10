import type { CapacitorConfig } from "@capacitor/cli";

// The Android app (android/) is a Capacitor shell around the hosted web app:
// its WebView loads server.url, so Next's server routes and server components
// keep working and nothing is bundled twice. webDir holds only a placeholder
// page (capacitor/www), shown for a moment before the site loads.
// PB_HOST: the deployed site. "pnpm cap:sync" copies it into the Android project,
// and the Gradle build reads it from there (android/app/build.gradle), so the
// WebView and the native code (message watcher, push) always use the same site.
const host = (process.env.PB_HOST || "https://hackathon-teamg-pausebutton-production.up.railway.app").replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "ai.apty.pausebutton",
  appName: "Pause Button",
  webDir: "capacitor/www",
  server: {
    url: host,
    androidScheme: "https",
    // Only for a debug build pointed at a laptop (PB_CLEARTEXT=1 with http://10.0.2.2:3000);
    // release builds never allow plain http whatever this says (AndroidManifest.xml).
    cleartext: process.env.PB_CLEARTEXT === "1",
  },
  android: {
    path: "android",
    allowMixedContent: false,
    backgroundColor: "#14202B",
  },
  plugins: {
    // Push messages are data only and the app shows them itself (PauseMessagingService),
    // so the push plugin has nothing to present. Light status bar icons: behind the
    // status bar is the dark strip at the top of every screen, or ink.
    SystemBars: { style: "DARK" },
  },
};

export default config;
