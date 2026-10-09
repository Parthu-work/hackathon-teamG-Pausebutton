"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { LoadingScreen, Screen, TitleRow, useToast } from "@/components/ui";
import { LANGUAGES, translator } from "@/lib/i18n";
import { api } from "@/lib/client/api";
import type { Language } from "@/lib/views";
import { useRao, useT } from "./shell";

/** F5a · Language: the chips stop saying "Phase 2". */
export function LanguageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  const { data } = useRao();
  const [picked, setPicked] = useState<Language | null>(null);
  const save = useMutation({
    mutationFn: (language: Language) => api("/api/me/settings", { method: "PATCH", body: { language } }),
    onSuccess: async (_r, language) => {
      await queryClient.invalidateQueries({ queryKey: ["rao-state"] });
      const tt = translator(language);
      toast({ title: tt("language.saved"), sub: tt("language.savedSub", { lang: LANGUAGES.find((l) => l.code === language)?.native ?? language }), icon: "globe" });
      router.push("/settings");
    },
  });
  if (!data) return <LoadingScreen />;
  const current = picked ?? data.me.language;

  return (
    <Screen>
      <TitleRow title={t("language.title")} back="/settings" />
      <p className="p">{t("language.choose")}</p>
      <div className="col" role="radiogroup" aria-label={t("language.title")}>
        {LANGUAGES.map((l) => {
          const on = current === l.code;
          return (
            <button
              key={l.code}
              role="radio"
              aria-checked={on}
              className="card row-card"
              style={{ border: on ? "3px solid var(--text)" : "2px solid var(--border-strong)", padding: 16 }}
              onClick={() => setPicked(l.code)}
            >
              <span className={`rad ${on ? "on" : ""}`} style={{ width: 26, height: 26 }} />
              <div className="grow">
                <div className="h2" style={{ fontSize: 24 }}>{l.native}</div>
                <p className="sm">{l.code === "en" ? t("language.defaultTag") : l.code === "hi" ? t("language.hindi") : t("language.telugu")}</p>
              </div>
              {l.code !== "en" && <span className="tag g">{t("language.ready")}</span>}
            </button>
          );
        })}
      </div>
      <div className="card tint-green">
        <div className="row"><Icon name="check" /><b style={{ fontSize: 16 }}>{t("language.checkerReads")}</b></div>
        <p className="sm" style={{ color: "var(--text)" }}>{t("language.checkerReadsBody")}</p>
      </div>
      <p className="sm">{t("language.beforeShipping")}</p>
      <div className="spacer" />
      <button className="btn amber" disabled={save.isPending || current === data.me.language} onClick={() => save.mutate(current)}>{t("language.save")}</button>
    </Screen>
  );
}
