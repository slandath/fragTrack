import { createTRPCReact } from "@trpc/react-query"
import { httpLink } from "@trpc/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import type { AppRouter } from "../../server/trpc/router"

const trpc = createTRPCReact<AppRouter>()

const trpcClient = trpc.createClient({
    links: [httpLink({ url: "/trpc" })],
})

function useQueryClientInstance() {
    const [queryClient] = useState(() => new QueryClient())
    return queryClient
}

export function TRPCProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClientInstance()

    return (
        <QueryClientProvider client= { queryClient } >
        <trpc.Provider client={ trpcClient } queryClient = { queryClient } >
            { children }
            </trpc.Provider>
            </QueryClientProvider>
    )
}

export { trpc }