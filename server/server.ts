import Fastify from "fastify";
import { auth } from "./utils/auth.js";
import { fromNodeHeaders } from "better-auth/node"
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

fastify.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const headers = fromNodeHeaders(request.headers)
    const req = new Request(url.toString(), {
      method: request.method,
      headers,
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    })
    const response = await auth.handler(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(response.body ? await response.text() : null)
  },
})

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
