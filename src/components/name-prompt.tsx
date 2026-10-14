"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { displayName } from "@/lib/display-name";

/**
 * An account made before sign-up asked for a name is still called "Guest", on
 * this phone, on the family's phones and in every alert. Until it has a real
 * name, the home screen asks once; saving updates it everywhere.
 */
export function NamePrompt({ name, endpoint, queryKey }: { name: string | null | undefined; endpoint: string; queryKey: string[] }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (name === undefined || displayName(name)) return null;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api(endpoint, { method: "PATCH", body: { name: value } });
      await queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card tint-amber" style={{ gap: 8 }} data-testid="name-prompt">
      <b style={{ fontSize: 17 }}>What should we call you?</b>
      <p className="sm" style={{ color: "var(--text)" }}>Your family and your alerts show this name.</p>
      <div className="in"><input aria-label="Your name" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Ramesh" /></div>
      {error && <p className="sm" style={{ color: "var(--red-text)", fontWeight: 700 }}>{error}</p>}
      <button className="btn amber sm-btn" disabled={saving || !value.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save my name"}</button>
    </div>
  );
}
