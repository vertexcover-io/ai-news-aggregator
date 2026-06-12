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
    // Bind IPv4 explicitly: *.lvh.me resolves to 127.0.0.1, but Node can bind
    // `localhost` as [::1] only, which refuses the <slug>.lvh.me dev flow.
    host: "127.0.0.1",
    allowedHosts: [
      ".trycloudflare.com",
      ".ngrok.app",
      ".ngrok-free.app",
      // Multi-tenant dev hosts: <slug>.lvh.me resolves to 127.0.0.1 via real
      // DNS, so tenant public sites are browsable at http://<slug>.lvh.me:5173.
      ".lvh.me",
    ],
    proxy: {
      // Use 127.0.0.1 (not localhost) so the proxy resolves IPv4 directly.
      // On macOS with IPv6 enabled, `localhost` may resolve to `::1` first,
      // and any unrelated process bound to `[::1]:3000` (e.g. a stray
      // Docusaurus dev server) will silently intercept API calls and
      // return 404. The Hono API binds to IPv4. Discovered debugging
      // Stage-5 VS-6 (login POST returned 404 from the wrong host).
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:3000",
        // Preserve the browser's Host header (changeOrigin would rewrite it to
        // the target): the API resolves the public tenant FROM the Host, so
        // <slug>.lvh.me:5173 must arrive as-is. Non-host requests (127.0.0.1,
        // tunnels) keep working — the API only uses Host for tenant routes,
        // and non-prod also honors an explicit X-Tenant-Slug header.
        changeOrigin: false,
      },
    },
  },
});
