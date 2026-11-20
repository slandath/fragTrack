import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").notNull().default("user"),
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [index("api_key_user_id_idx").on(table.userId)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const fragrance = pgTable(
  "fragrance",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    brand: text("brand").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("fragrance_user_id_idx").on(table.userId)],
);

export const retailerUrl = pgTable(
  "retailer_url",
  {
    id: text("id").primaryKey(),
    fragranceId: text("fragrance_id")
      .notNull()
      .references(() => fragrance.id, { onDelete: "cascade" }),
    // Derived from the URL at creation time. The authoritative list of
    // supported domains and selectors remains `domainConfigs`; this column
    // only records which configured domain a URL belongs to (Spec 07).
    retailerDomain: text("retailer_domain").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("retailer_url_fragrance_url_unique").on(table.fragranceId, table.url),
    // The unique index already covers fragrance_id as its leftmost prefix;
    // this explicit index is kept for FK/lookup clarity and to support
    // selective cleanup queries without scanning the wider unique index.
    index("retailer_url_fragrance_id_idx").on(table.fragranceId),
    index("retailer_url_retailer_domain_idx").on(table.retailerDomain),
  ],
);

export const price = pgTable(
  "price",
  {
    id: text("id").primaryKey(),
    retailerUrlId: text("retailer_url_id")
      .notNull()
      .references(() => retailerUrl.id, { onDelete: "cascade" }),
    // Exact integer minor units (cents). Never floating point.
    amountMinor: integer("amount_minor").notNull(),
    // Whole-number legacy amounts (e.g. "2030", possibly a collapsed price
    // range) convert but stay quarantined: excluded from displayed prices
    // until an operator verifies them. New observations are never quarantined.
    quarantined: boolean("quarantined").notNull().default(false),
    currency: text("currency").notNull().default("USD"),
    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  },
  (table) => [
    index("price_retailer_url_scraped_at_idx").on(table.retailerUrlId, table.scrapedAt.desc()),
    check(
      "price_amount_minor_range",
      sql`${table.amountMinor} > 0 AND ${table.amountMinor} <= 99999999`,
    ),
    check("price_currency_code", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);
