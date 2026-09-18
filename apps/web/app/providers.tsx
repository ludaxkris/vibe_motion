"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { MockProvider } from "@/mocks/MockProvider";

/**
 * Client-side providers for the whole app.
 *
 * Kept as the only "use client" boundary in the root layout so pages stay
 * Server Components by default (CLAUDE.md, "Web" conventions). Server data goes
 * through TanStack Query with the generated client in `lib/api-client`.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The editor is long-lived; refetching on every focus would fight
            // the client-side draft. Phase 3+ tunes this per query.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MockProvider>{children}</MockProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
