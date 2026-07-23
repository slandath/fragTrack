import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create();

export const appRouter = t.router({
  healthcheck: t.procedure.query(() => ({
    status: "ok",
    timestamp: Date.now(),
  })),
});

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});
export const protectedProcedure = t.procedure.use(isAuthed);

export type AppRouter = typeof appRouter;
