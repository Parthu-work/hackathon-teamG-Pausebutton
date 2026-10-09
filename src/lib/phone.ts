/**
 * "+91 98765 43210" from what people type (spaces, dashes, +91, 0091 or a
 * leading 0), the same format sign-in uses. Null if it is not an Indian mobile number.
 */
export function toIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^(?:0091|091|91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
