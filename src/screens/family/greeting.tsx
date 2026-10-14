"use client";

import { NamePrompt } from "@/components/name-prompt";
import { useClientValue } from "@/components/ui";
import { displayName } from "@/lib/display-name";

const currentHour = () => new Date().getHours();

/**
 * The top of a family home: "Good morning, Arjun". The time of day is the
 * phone's own clock, so it renders after hydration (the afternoon until then).
 * An old "Guest" account gets the plain greeting.
 */
export function Greeting({ name }: { name: string }) {
  const hour = useClientValue(currentHour, null) ?? 12;
  const first = displayName(name);
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return (
    <>
      <p className="h2" style={{ fontSize: 22 }} data-testid="greeting">
        {first ? `Good ${part}, ${first}` : `Good ${part}`}
      </p>
      <NamePrompt name={name} endpoint="/api/family/settings" queryKey={["family-state"]} />
    </>
  );
}
