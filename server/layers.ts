import { Context, Data, Effect, Layer } from "effect";
import { db } from "./index.js";
import { env } from "./env-startup.js";
import type { ServerEnv } from "./env.js";

/** Startup configuration failure with an actionable, value-free message. */
export class ConfigFailure extends Data.TaggedError("ConfigFailure")<{ message: string }> {}

export interface Config {
  readonly env: ServerEnv;
}
export const Config = Context.GenericTag<Config>("fragTrack/Config");

/**
 * Validation happens once, when `env-startup` is imported. The layer only
 * exposes that validated value to Effect programs — no shape is validated
 * twice (Spec 08 validation ownership rule).
 */
export const ConfigLive = Layer.effect(
  Config,
  Effect.try({
    try: () => ({ env }),
    catch: (error) =>
      new ConfigFailure({ message: error instanceof Error ? error.message : String(error) }),
  }),
);

/** Process-wide Drizzle client as a layer, so internals can depend on it. */
export interface Database {
  readonly db: typeof db;
}
export const Database = Context.GenericTag<Database>("fragTrack/Database");
export const DatabaseLive = Layer.succeed(Database, { db });

export const AppLayer = Layer.mergeAll(ConfigLive, DatabaseLive);
