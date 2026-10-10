import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

// The name both home screens greet by ("Good morning, Ramesh").
describe("displayName", () => {
  it("greets by the first name", () => {
    expect(displayName("Ramesh Rao")).toBe("Ramesh");
    expect(displayName("  Arjun   Kumar ")).toBe("Arjun");
    expect(displayName("Meera")).toBe("Meera");
  });

  it("keeps a title with the name after it: Mr Rao stays Mr Rao", () => {
    expect(displayName("Mr Rao")).toBe("Mr Rao");
    expect(displayName("Mrs. Rao")).toBe("Mrs. Rao");
    expect(displayName("Dr Sharma Ji")).toBe("Dr Sharma");
  });

  it("has no name for a blank one or the old Guest placeholder, so the screen says the plain greeting", () => {
    for (const none of ["", "   ", null, undefined, "Guest", "guest", " GUEST "]) expect(displayName(none)).toBeNull();
  });

  it("gives the whole name, tidied, with { full: true }", () => {
    expect(displayName("  Ramesh   Rao ", { full: true })).toBe("Ramesh Rao");
    expect(displayName("Mr Rao", { full: true })).toBe("Mr Rao");
    expect(displayName("Guest", { full: true })).toBeNull();
  });
});
