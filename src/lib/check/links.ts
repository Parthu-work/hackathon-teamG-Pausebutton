import type { LinkInfo, LinkStatus } from "./types";
import blocklist from "@/data/blocklist.json";

// Official sites of the banks, shops, couriers and government bodies that
// scams most often pretend to be. A link to one of these is "known".
const OFFICIAL = [
  "sbi.co.in", "onlinesbi.sbi", "onlinesbi.com", "sbi.bank.in", "hdfcbank.com", "icicibank.com",
  "axisbank.com", "kotak.com", "pnbindia.in", "bankofbaroda.in", "canarabank.com",
  "unionbankofindia.co.in", "paytm.com", "phonepe.com", "pay.google.com", "amazon.in",
  "amazon.com", "flipkart.com", "myntra.com", "indiapost.gov.in", "bluedart.com", "fedex.com",
  "dhl.com", "delhivery.com", "irctc.co.in", "uidai.gov.in", "incometax.gov.in",
  "epfindia.gov.in", "npci.org.in", "rbi.org.in", "cybercrime.gov.in", "sancharsaathi.gov.in",
  "licindia.in", "airtel.in", "jio.com", "myvi.in", "tsspdcl.in", "apspdcl.in", "bescom.co.in",
];

// Words that, inside an unofficial domain, mean it is pretending to be a brand.
const BRANDS = [
  "sbi", "yono", "hdfc", "icici", "axis", "kotak", "pnb", "baroda", "canara", "paytm", "phonepe",
  "gpay", "googlepay", "amazon", "flipkart", "indiapost", "bluedart", "fedex", "dhl", "delhivery",
  "irctc", "uidai", "aadhaar", "aadhar", "incometax", "epfo", "npci", "rbi", "lic", "airtel",
  "jio", "trai", "bses", "tatapower",
];

const SHORTENERS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "shorturl.at", "t.ly",
  "ow.ly", "rebrand.ly", "s.id", "tiny.cc", "v.gd",
];

const ODD_TLDS = new Set([
  "top", "xyz", "live", "click", "link", "icu", "buzz", "online", "site", "shop", "club", "work",
  "rest", "cyou", "vip", "tk", "ml", "ga", "cf", "gq", "loan", "win", "bid", "monster", "sbs", "cfd",
  "info",
]);

const TLDS =
  "com|in|net|org|co|info|io|app|me|ly|gl|gov|edu|biz|xyz|top|live|click|link|icu|buzz|online|site|shop|club|work|rest|cyou|vip|tk|ml|ga|cf|gq|loan|win|bid|monster|sbs|cfd|at|cc|gd|id|sbi|bank|pro|tech|store";

const LINK_RE = new RegExp(
  String.raw`(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS}))(?![a-z0-9-])(?::\d+)?(?:\/[^\s]*)?|(?:https?:\/\/)?((?:\d{1,3}\.){3}\d{1,3})(?:\/[^\s]*)?`,
  "giu",
);

const RANK: Record<LinkStatus, number> = { known: 0, unknown: 1, risky: 2, lookalike: 3, blocked: 4 };

export function findLinks(original: string): LinkInfo[] {
  const links: LinkInfo[] = [];
  for (const m of original.matchAll(LINK_RE)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    const domain = (m[1] ?? m[2] ?? "").toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    const { status, reason } = classify(domain, !!m[2]);
    links.push({ url, domain, status, reason, start: m.index!, end: m.index! + url.length });
  }
  return links;
}

/** The most dangerous link in the message, if any. */
export function worstLink(links: LinkInfo[]): LinkInfo | null {
  return links.reduce<LinkInfo | null>((worst, l) => (!worst || RANK[l.status] > RANK[worst.status] ? l : worst), null);
}

function classify(domain: string, isIp: boolean): { status: LinkStatus; reason: string } {
  if (isIp) return { status: "risky", reason: "It is a bare number address, which real firms do not use." };
  if ((blocklist as string[]).some((b) => domain === b || domain.endsWith("." + b)))
    return { status: "blocked", reason: "This site is on our list of known scam sites." };
  if (isOfficial(domain)) return { status: "known", reason: "This is an official site." };
  if (SHORTENERS.includes(domain))
    return { status: "risky", reason: "A short link hides the real site it opens." };

  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  const words = labels.slice(0, -1).flatMap((l) => l.split("-"));
  const brand = BRANDS.find((b) => words.some((w) => w === b || (b.length >= 4 && w.includes(b))));
  if (brand) {
    return {
      status: "lookalike",
      reason: `It uses the name “${brand.toUpperCase()}” but is not their official site.`,
    };
  }
  const near = nearOfficial(labels[0]);
  if (near) return { status: "lookalike", reason: `It looks like ${near} but is spelled differently.` };
  if (ODD_TLDS.has(tld)) return { status: "risky", reason: "Real firms do not use web addresses like this." };
  return { status: "unknown", reason: "We do not know this site." };
}

function isOfficial(domain: string) {
  if (domain.endsWith(".gov.in") || domain.endsWith(".nic.in")) return true;
  return OFFICIAL.some((o) => domain === o || domain.endsWith("." + o));
}

/** A first label within two edits of an official one, e.g. "hdfcbnak". */
function nearOfficial(label: string): string | null {
  if (label.length < 5) return null;
  for (const o of OFFICIAL) {
    const first = o.split(".")[0];
    if (first.length >= 5 && first !== label && editDistance(first, label) <= 2) return o;
  }
  return null;
}

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
