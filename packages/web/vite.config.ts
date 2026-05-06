import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  server: {
    proxy: {
      // Use 127.0.0.1 (not localhost) so the proxy resolves IPv4 directly.
      // On macOS with IPv6 enabled, `localhost` may resolve to `::1` first,
      // and any unrelated process bound to `[::1]:3000` (e.g. a stray
      // Docusaurus dev server) will silently intercept API calls and
      // return 404. The Hono API binds to IPv4. Discovered debugging
      // Stage-5 VS-6 (login POST returned 404 from the wrong host).
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
