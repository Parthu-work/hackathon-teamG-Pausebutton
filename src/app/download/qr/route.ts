import { connection } from "next/server";
import QRCode from "qrcode";

/**
 * A QR code for this deployment's /download page, as SVG. It encodes whatever
 * address the request came in on, so it is right on Railway, Vercel or a tunnel
 * without configuration. Print it or put it on a slide: /download/qr
 */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? url.protocol.replace(":", "");
  const target = `${proto}://${host}/download`;
  const svg = await QRCode.toString(target, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#14202B", light: "#FFFFFF" } });
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}
