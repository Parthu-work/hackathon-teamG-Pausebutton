"use client";

import { dict } from "@/lib/i18n";

// The root layout itself failed: no global styles or fonts here, so the page
// carries its own few. Wording from the dictionaries, as on every screen.

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const d = dict(typeof document === "undefined" ? "en" : document.documentElement.lang).common;
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#F6F3EE", color: "#14202B", fontFamily: "system-ui, sans-serif" }}>
        <title>{d.appName}</title>
        <main style={{ maxWidth: 420, padding: 24, display: "grid", gap: 16 }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>{d.errorTitle}</h1>
          <p style={{ fontSize: 20, margin: 0 }}>{d.errorBody}</p>
          <button onClick={() => retry()} style={{ minHeight: 56, fontSize: 20, fontWeight: 700, borderRadius: 14, border: 0, background: "#14202B", color: "#fff" }}>
            {d.tryAgain}
          </button>
          {error.digest && <p style={{ fontSize: 15, margin: 0, color: "#4A5A68" }}>{d.errorRef}: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
