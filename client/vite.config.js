import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/trpc": "http://localhost:3000",
      "/api/auth": "http://localhost:3000",
    },
  },
});
