import Fastify from "fastify";
import fastifyStatic from "@fastify/static"
import { auth } from "./utils/auth.js";
import { fromNodeHeaders } from "better-auth/node"
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import path from "node:path"
import { fileURLToPath } from "node:url"

const fastify = Fastify({
  logger: true,
});

if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const clientDist = path.resolve(__dirname, "../client/dist")
  await fastify.register(fastifyStatic, { root: clientDist })
  fastify.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"))
}

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
    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
