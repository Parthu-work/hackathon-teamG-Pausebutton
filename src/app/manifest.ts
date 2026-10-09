import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pause Button",
    short_name: "Pause",
    description: "A calm second opinion, before the money moves.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F5F0",
    theme_color: "#14202B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    orientation: "portrait",
    categories: ["utilities", "security"],
    // F1 · Forward to Pause: once installed, "Pause Button" appears in the
    // phone's Share sheet. The shared text lands on /share and is checked.
    share_target: { action: "/share", method: "GET", params: { text: "text", title: "title", url: "url" } },
  } as MetadataRoute.Manifest;
}
