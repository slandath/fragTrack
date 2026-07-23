import { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { db } from "../index.js"

export const createContext = ({ req, res }: CreateFastifyContextOptions) => ({
    db,
})

export type Context = Awaited<ReturnType<typeof createContext>>;