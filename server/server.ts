import "dotenv/config";
// Validate after dotenv loads .env, before modules that read configuration.
import { Effect, Exit, Scope } from "effect";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { auth } from "./utils/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppLayer, Config, Database } from "./layers.js";
import { listenScoped } from "./startup.js";

const fastify = Fastify({
  logger: true,
});

const program = Effect.gen(function* () {
  const { env } = yield* Config;
  // Build the process-wide DB client before serving requests.
  yield* Database;

  // Fastify, @fastify/static, the tRPC adapter, and the better-auth bridge
  // stay exactly as they were; only wiring moves into the scoped program.
  if (env.nodeEnv === "production") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const clientDist = path.resolve(__dirname, "../client/dist");
    yield* Effect.promise(() => fastify.register(fastifyStatic, { root: clientDist }));
    fastify.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  yield* Effect.promise(() =>
    fastify.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: { router: appRouter, createContext },
    }),
  );

  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });

  yield* listenScoped(fastify, env.port);
});

// Keep one scope open for the lifetime of the process: the server stays up
// until a termination signal closes the scope and releases the listener.
const main = async () => {
  const scope = await Effect.runPromise(Scope.make());
  let closing = false;
  const closeScope = () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));

  const shutdown = () => {
    if (closing) return;
    closing = true;
    void closeScope().then(
      () => process.exit(0),
      (error) => {
        fastify.log.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serving = Effect.runPromise(Effect.provide(Scope.extend(program, scope), AppLayer));

  try {
    await serving;
  } catch (err) {
    fastify.log.error(err);
    // A failed startup can still have acquired resources (e.g. a listener
    // registered before listen failed); release them before exiting.
    if (!closing) {
      closing = true;
      try {
        await closeScope();
      } catch (closeError) {
        fastify.log.error(closeError);
      }
    }
    process.exit(1);
  }
};

void main();
