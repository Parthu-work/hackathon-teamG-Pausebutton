"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Screen } from "@/components/ui";
import { dict } from "@/lib/i18n";

// A screen that failed on the server or in the browser. The wording comes from
// the dictionaries, in the language Mr Rao's phone is set to (his shell sets
// <html lang>); the digest matches the server's request_error log line.

const noop = () => () => {};
const usePageLang = () => useSyncExternalStore(noop, () => document.documentElement.lang, () => "en");

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const d = dict(usePageLang()).common;
  return (
    <Screen>
      <div className="row" style={{ gap: 10 }}>
        <Icon name="warn" />
        <h1 className="h1">{d.errorTitle}</h1>
      </div>
      <p className="p">{d.errorBody}</p>
      <button className="btn ink" onClick={() => retry()}>{d.tryAgain}</button>
      {error.digest && <p className="sm">{d.errorRef}: {error.digest}</p>}
    </Screen>
  );
}
