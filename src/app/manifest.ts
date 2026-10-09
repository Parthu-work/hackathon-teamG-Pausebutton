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
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
