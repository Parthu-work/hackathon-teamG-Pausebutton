/**
 * "+91 98765 43210" from what people type (spaces, dashes, +91, 0091 or a
 * leading 0), the same format sign-in uses. Null if it is not an Indian mobile number.
 */
export function toIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^(?:0091|091|91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** Keeps the last 10 digits and formats them like "+91 98765 43210". Null if not a 10-digit number. */
export function formatPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** "+91 98765 43210" → "tel:+919876543210" (opens the phone's dialer). */
export function telHref(phone: string) {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

/** The national cyber-crime helpline (I4C), used by the "Call cyber helpline 1930" buttons. */
export const HELPLINE = "1930";
