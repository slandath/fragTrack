import Fastify from "fastify";
import { auth } from "./utils/auth.js";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

const fastify = Fastify({
  logger: true,
});

await fastify.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

fastify.all("/api/auth/*", async (request, reply) => {
  await auth.handler(request.raw, reply.raw);
});

fastify.get("/", async () => ({ hello: "world" }));

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
