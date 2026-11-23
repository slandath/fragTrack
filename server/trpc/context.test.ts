import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { describe, expect, it } from "vitest";
import { makeCreateContext } from "./context.js";
import type { Database } from "../layers.js";

/** The tRPC boundary must use the injected layer value, not a raw db import. */
describe("tRPC context database injection", () => {
  it("exposes the injected Database layer value on the context", async () => {
    const fakeDatabase = { db: {} } as unknown as Database;
    const createContext = makeCreateContext(fakeDatabase);

    // A malformed key short-circuits to the unauthenticated branch without
    // touching the database or the auth service.
    const context = await createContext({
      req: { headers: { authorization: "Bearer not-a-valid-key" } },
    } as unknown as CreateFastifyContextOptions);

    expect(context.db).toBe(fakeDatabase.db);
    expect(context.authType).toBe("none");
  });
});
