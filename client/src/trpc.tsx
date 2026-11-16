import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppRouter } from "../../server/trpc/router";
import { authClient } from "./auth";

const trpc = createTRPCReact<AppRouter>();

const trpcClient = trpc.createClient({
  links: [httpLink({ url: "/trpc" })],
});

function useQueryClientInstance() {
  const [queryClient] = useState(() => new QueryClient());
  return queryClient;
}

/**
 * Clear cached protected data whenever the signed-in identity changes —
 * including sign-out and switching accounts in another tab. Without this,
 * a second user could briefly see the previous user's cached queries.
 */
function SessionCacheReset() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const previousUserId = useRef(userId);

  useEffect(() => {
    if (previousUserId.current !== userId) {
      queryClient.clear();
      previousUserId.current = userId;
    }
  }, [userId, queryClient]);

  return null;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClientInstance();

  return (
    <QueryClientProvider client={queryClient}>
      <SessionCacheReset />
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
}

export { trpc };
