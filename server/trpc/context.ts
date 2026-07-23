import { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../index.js";
import { auth } from "../utils/auth.js";

export const createContext = async ({ req }: CreateFastifyContextOptions) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return { db, session };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
