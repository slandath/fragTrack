// Import this module (not env.ts) when a runtime needs the validated singleton.
import { validateEnv } from "./env.js";

/** Validated at module load so an invalid startup fails before any DB access. */
export const env = validateEnv();
