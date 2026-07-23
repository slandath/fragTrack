import { initTRPC } from "@trpc/server"
import type { Context } from "./context.js"

const t = initTRPC.context<Context>().create();

export const appRouter = t.router({
    healthcheck: t.procedure.query(() => ({
        status: "ok",
        timestamp: Date.now(),
    })),
})

export type AppRouter = typeof appRouter;