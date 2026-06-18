import { defineManifest } from "@crxjs/vite-plugin";

// Single source of truth for the API origin — also drives VITE_API_BASE in vite.config.ts.
// Set VITE_API_BASE at build time to target prod (e.g. https://agentloop.vertexcover.io).
const apiBase = process.env.VITE_API_BASE ?? "http://localhost:3000";

// Deterministic extension ID: alnmmlkpbceggejnpiajajenakencoeb
// Derived from the RSA public key below (SHA256 of DER SPKI, first 16 bytes, a-p encoded)
// Phase 4 CORS allowlist and e2e assertions use this ID.
export default defineManifest({
  manifest_version: 3,
  name: "The Daily Read — Add Story",
  version: "0.1.0",
  description: "Add the current tab to the next newsletter run",
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  // Fixed key so the extension ID is deterministic across builds.
  // Generated with: openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuKwZaV4kLOi5wRm3ELYVNEMbyRP4qQybWTRClm80F9gDBGNB4phTibr7b+nwdD+n1ByR7Lm194Qoh9pHMWTTaMuwl5c79k3Pr2UCfDs9w5RqTOa6Kol2B6wKXMj2LUpTn+lpKgZmGs4y7G7ZNVOVH/5AOL+viIG6dXIdxqskdfx0j48yii03f7RbUu4xR8HUpTNM1DXHKOcKyfqShk+vdaKyeKcM8MGDS4EDLpcyhRrBBCbjAwVeK7y3QLRMcQX/VeN/hZIc8Vp3t2GxryKo3/DiRkTKxMjsQeB/K+ih6Vi/FD1UFl1lJdGHZulcYvs2bciqgqROBpeOoHF+/0xHewIDAQAB",
  action: {
    default_popup: "index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  permissions: ["tabs", "storage", "activeTab"],
  // Scope host access to the API origin only — the popup just fetches the API.
  // Driven by VITE_API_BASE so a prod build (e.g. https://agentloop.vertexcover.io)
  // gets the right host grant; avoid broad "https://*/*" which triggers an
  // all-sites access warning on install. Localhost kept for dev/e2e.
  host_permissions: [
    `${apiBase}/*`,
    "http://localhost:3000/*",
    "http://127.0.0.1/*",
  ],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
});
