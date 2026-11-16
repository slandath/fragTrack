import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import * as schema from "../db/schema.js";
import { db } from "../index.js";
import { env } from "../env.js";

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  basePath: "/api/auth",
  trustedOrigins: env.frontendUrl ? [env.frontendUrl] : [],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  // Credentials are validated at startup; in test mode they may be absent,
  // so the provider is configured only when both are present.
  socialProviders:
    env.githubClientId && env.githubClientSecret
      ? {
          github: {
            clientId: env.githubClientId,
            clientSecret: env.githubClientSecret,
          },
        }
      : {},
  advanced: {
    cookiePrefix: "fragTrack",
    useSecureCookies: env.nodeEnv === "production",
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["::1", "::ffff:127.0.0.1"],
    },
    defaultCookieAttributes:
      env.nodeEnv === "production"
        ? {
            sameSite: "none",
            secure: true,
          }
        : {
            sameSite: "lax",
            secure: false,
          },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        required: false,
        input: false,
      },
    },
  },
  plugins: [
    admin({
      adminUserIds: env.adminUserIds,
    }),
  ],
});
