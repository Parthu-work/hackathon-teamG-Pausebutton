import type { Metadata } from "next";

export const metadata: Metadata = { title: "Get Pause Button" };

/** Public: anyone who scans the QR lands here and can install the Android app. */
export default function Page() {
  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", padding: "32px 16px 48px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, lineHeight: 1.1, margin: 0 }}>Get Pause Button</h1>
        <p style={{ fontSize: 18, color: "var(--muted)", margin: 0 }}>Checks a message before you pay, and tells your family when something looks like a scam.</p>

        <a className="btn big" href="/pause-button.apk" download="pause-button.apk">
          Download for Android
        </a>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: "16px 18px", fontSize: 17 }}>
          <h2 style={{ fontSize: 19, margin: "0 0 8px" }}>Installing</h2>
          <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 6 }}>
            <li>Tap <b>Download for Android</b>, then open the file.</li>
            <li>If Android asks, allow installs from Chrome (or your file app) once.</li>
            <li>If Play Protect warns about an unknown app: <b>More details → Install anyway</b>. This is a test build.</li>
            <li>
              Already have Pause Button? Install this one over it. It now opens as its own app, not in Chrome, so sign in once more the first time.
            </li>
            <li>If Android says <b>App not installed</b>, uninstall the old Pause Button first (early test builds were signed differently), then install again.</li>
            <li>
              Open <b>Pause Button</b>. When it asks, allow notifications, so family alerts reach you even when the app is closed. You can say no and still use
              it.
            </li>
          </ol>
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: "16px 18px", fontSize: 17 }}>
          <h2 style={{ fontSize: 19, margin: "0 0 8px" }}>iPhone or no install?</h2>
          <p style={{ margin: 0 }}>
            Open <a href="/welcome">the web app</a>. In Safari, tap Share → <b>Add to Home Screen</b>.
          </p>
        </section>

        <section style={{ textAlign: "center", display: "grid", gap: 8, justifyItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG made per request */}
          <img src="/download/qr" alt="QR code for this page" width={220} height={220} style={{ borderRadius: 12, background: "#fff" }} />
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 15 }}>Show this to someone else to share the app.</p>
        </section>
      </div>
    </main>
  );
}
