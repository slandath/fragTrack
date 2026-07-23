import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import * as schema from "../db/schema.js";
import { db } from "../index.js";

const frontendUrl = process.env.FRONTEND_URL;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  trustedOrigins: frontendUrl ? [frontendUrl] : [],
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
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  advanced: {
    cookiePrefix: "fragTrack",
    useSecureCookies: process.env.NODE_ENV === "production",
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["::1", "::ffff:127.0.0.1"]
    },
    defaultCookieAttributes:
      process.env.NODE_ENV === "production"
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
      adminUserIds: process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(",") : [],
    }),
  ],
});
