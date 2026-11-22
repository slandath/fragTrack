import { Effect, Either } from "effect";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { Config, ConfigLive } from "./layers.js";
import { listenScoped } from "./startup.js";

function fakeFastify(listenError?: Error) {
  const calls = { listen: 0, close: 0, port: 0 };
  const fastify = {
    listen: async ({ port }: { port: number }) => {
      calls.listen++;
      calls.port = port;
      if (listenError) throw listenError;
      return "http://localhost";
    },
    close: async () => {
      calls.close++;
    },
  } as unknown as FastifyInstance;
  return { fastify, calls };
}

describe("scoped server startup", () => {
  it("closes a listening server when the scope ends", async () => {
    const fake = fakeFastify();
    await Effect.runPromise(Effect.scoped(listenScoped(fake.fastify, 3000)));
    expect(fake.calls).toEqual({ listen: 1, close: 1, port: 3000 });
  });

  it("does not attempt a close when listen fails", async () => {
    const fake = fakeFastify(new Error("EADDRINUSE"));
    const result = await Effect.runPromise(
      Effect.either(Effect.scoped(listenScoped(fake.fastify, 3000))),
    );
    expect(Either.isLeft(result)).toBe(true);
    expect(fake.calls.listen).toBe(1);
    expect(fake.calls.close).toBe(0);
  });

  it("exposes the env validated once at startup through the Config layer", async () => {
    const env = await Effect.runPromise(
      Effect.flatMap(Config, ({ env }) => Effect.succeed(env)).pipe(Effect.provide(ConfigLive)),
    );
    expect(env.nodeEnv).toBe("test");
    expect(env.port).toBe(3000);
  });
});
