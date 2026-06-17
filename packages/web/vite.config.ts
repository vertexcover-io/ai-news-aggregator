import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { devTenantSlugFromHost } from "./src/dev/tenant-host";

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
    allowedHosts: [".trycloudflare.com", ".ngrok.app", ".ngrok-free.app", ".lvh.me"],
    proxy: {
      // Use 127.0.0.1 (not localhost) so the proxy resolves IPv4 directly.
      // On macOS with IPv6 enabled, `localhost` may resolve to `::1` first,
      // and any unrelated process bound to `[::1]:3000` (e.g. a stray
      // Docusaurus dev server) will silently intercept API calls and
      // return 404. The Hono API binds to IPv4. Discovered debugging
      // Stage-5 VS-6 (login POST returned 404 from the wrong host).
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: true,
        // `changeOrigin: true` rewrites the outgoing Host to the target, so the
        // browser's `<slug>.lvh.me` never reaches the API. Bridge it for local
        // multi-tenant dev: derive the slug from the incoming Host and forward
        // it via the API's `X-Tenant-Slug` dev override (dev-only by design).
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const slug = devTenantSlugFromHost(req.headers.host);
            if (slug) proxyReq.setHeader("x-tenant-slug", slug);
          });
        },
      },
    },
  },
});
