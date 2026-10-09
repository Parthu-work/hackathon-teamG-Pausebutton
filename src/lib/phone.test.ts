import { describe, expect, it } from "vitest";
import { formatPhone, telHref } from "./phone";

describe("phone numbers", () => {
  it("formats any way of typing a 10-digit Indian number", () => {
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+91-98765-43210")).toBe("+91 98765 43210");
    expect(formatPhone("098765 43210")).toBe("+91 98765 43210");
    expect(formatPhone("12345")).toBeNull();
  });

  it("builds dialer links", () => {
    expect(telHref("+91 98765 43210")).toBe("tel:+919876543210");
    expect(telHref("1930")).toBe("tel:1930");
  });
});
