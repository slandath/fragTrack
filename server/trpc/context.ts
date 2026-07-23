import { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { db } from "../index.js";
import { auth } from "../utils/auth.js";

export const createContext = async ({ req, _res }: CreateFastifyContextOptions) => {
  const session = await auth.api.getSession({ headers: req.headers });
  return { db, session };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
