import { Effect } from "effect";
import type { FastifyInstance } from "fastify";

/**
 * Fastify listen/close as one scoped resource. `acquireRelease` closes the
 * server when the surrounding scope ends (including interruption); a failed
 * listen never acquires, so no close is attempted.
 */
export const listenScoped = (fastify: FastifyInstance, port: number) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => fastify.listen({ port, host: "0.0.0.0" }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
    () => Effect.promise(() => fastify.close()),
  );
