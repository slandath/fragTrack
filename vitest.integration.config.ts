import { defineConfig } from "vitest/config";

// Integration tests exercise the real tRPC router against a disposable
// PostgreSQL database. They only run when TEST_DATABASE_URL is set:
//
//   TEST_DATABASE_URL=postgresql://user:password@host:5432/fragtest pnpm test:integration
//
// Never point TEST_DATABASE_URL at a development or production database:
// setup applies all committed migrations and wipes its tables.
export default defineConfig({
  test: {
    include: ["server/**/*.integration.test.ts"],
    exclude: ["node_modules/**", "client/**"],
    environment: "node",
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
