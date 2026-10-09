"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 0 } } }),
  );
  // Toasts are provided per phone frame (see ToastProvider in the app shells), not here:
  // Next keeps the previous route mounted but hidden, and a hidden frame must not mirror them.
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
