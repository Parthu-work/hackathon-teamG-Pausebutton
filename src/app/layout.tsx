import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted (src/app/fonts): the build never fetches fonts, so it works offline.
const body = localFont({
  variable: "--font-atkinson",
  src: [
    { path: "./fonts/atkinson-hyperlegible-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-700.woff2", weight: "700", style: "normal" },
  ],
});
const display = localFont({ variable: "--font-bricolage", src: "./fonts/bricolage-grotesque-600-800.woff2", weight: "600 800" });
// F5: Hindi and Telugu screens read in proper Devanagari and Telugu faces, not a fallback.
const devanagari = localFont({ variable: "--font-devanagari", src: "./fonts/noto-sans-devanagari-400-800.woff2", weight: "400 800" });
const telugu = localFont({ variable: "--font-telugu", src: "./fonts/noto-sans-telugu-400-800.woff2", weight: "400 800" });

export const metadata: Metadata = {
  title: "Pause Button",
  description: "A calm second opinion, before the money moves. Hackathon prototype: no real messages, no real money.",
  applicationName: "Pause Button",
  appleWebApp: { capable: true, title: "Pause Button", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#14202B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${devanagari.variable} ${telugu.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
