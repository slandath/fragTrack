import { Effect } from "effect";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

/**
 * Register the HTTP plugins (client static assets + tRPC).
 *
 * `fastify.register` is synchronous and returns the instance for chaining —
 * not a promise — so this must stay `Effect.sync`. Wrapping it in
 * `Effect.promise` crashes startup: the Effect runtime calls `.then` on the
 * returned instance, which fails with
 * "evaluate(...).then is not a function" and kills the process.
 */
export const registerAppPlugins = (fastify: FastifyInstance, clientDist?: string) =>
  Effect.sync(() => {
    if (clientDist !== undefined) {
      fastify.register(fastifyStatic, { root: clientDist });
      fastify.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
    }
    fastify.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: { router: appRouter, createContext },
    });
  });
