import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts"],
    exclude: ["server/**/*.integration.test.ts", "node_modules/**", "client/**"],
    environment: "node",
    // Unit tests must never depend on a developer `.env` file or a live
    // database. Provide a dummy URL so importing the server DB module does
    // not throw at import time; no connection is opened until a query runs.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    },
  },
});
