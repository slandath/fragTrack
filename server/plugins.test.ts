import { Effect, Either } from "effect";
import Fastify from "fastify";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerAppPlugins } from "./plugins.js";

describe("app plugin registration", () => {
  it("registers the tRPC plugin on a real Fastify instance", async () => {
    const fastify = Fastify();
    try {
      const result = await Effect.runPromise(Effect.either(registerAppPlugins(fastify)));
      expect(Either.isRight(result)).toBe(true);
      await fastify.ready();
    } finally {
      await fastify.close();
    }
  });

  it("registers the static plugin when a client dist root is given", async () => {
    const fastify = Fastify();
    try {
      const root = await mkdtemp(join(tmpdir(), "fragtrack-"));
      const result = await Effect.runPromise(Effect.either(registerAppPlugins(fastify, root)));
      expect(Either.isRight(result)).toBe(true);
      await fastify.ready();
    } finally {
      await fastify.close();
    }
  });
});
