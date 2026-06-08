# Learnings — centralized-observability

Task-specific notes for this feature's implementation. Global lessons extracted to `.harness/knowledge/lessons/`.

---

## IncidentRepository interface completeness: both packages must implement all methods

**Context:** The `IncidentRepository` interface (defined in `packages/shared/src/types/incident.ts`) was shared by both `api` and `pipeline`. The API repo needed `list()` and `setStatus()` for the admin route; the pipeline repo only needed `listUndelivered`, `markDelivered`, and `incrementDeliveryAttempts` for the sweep.

**What happened:** When `list()` and `setStatus()` were added to the interface, the pipeline's implementation also needed stub implementations to satisfy TypeScript — even though the pipeline never calls them. Both repos must implement the full interface.

**Rationale for keeping one interface (not two):** Splitting into `CoreIncidentRepository` and `ApiIncidentRepository` would require web code to handle both types. The shared interface is the contract for both consumers; the pipeline implements the admin methods as stubs (they simply throw if called, which is fine since the pipeline worker never calls them).

**Pattern:** See also the global lesson `typescript-monorepo-shared-interface-rebuild-before-downstream-typecheck-20260608.md` — whenever the shared interface grows, rebuild shared before typechecking downstream packages.

---

## Vite proxy env var: VITE_API_TARGET (not VITE_API_BASE)

**Context:** During functional verification, the web dev server was started with `VITE_API_BASE=http://localhost:3001`, but `packages/web/vite.config.ts` reads `process.env.VITE_API_TARGET`. The proxy fell back to `http://127.0.0.1:3000` (nothing listening), returning 404 for all API calls.

**Fix:** Use `VITE_API_TARGET=http://127.0.0.1:<port> pnpm --filter @newsletter/web dev`.

**Reference:** `packages/web/vite.config.ts` — the proxy target variable is `VITE_API_TARGET`.

---

## Global lessons extracted from this feature

- `gotchas/e2e-real-db-hermetic-cleanup-prefix-uniqueness-20260608.md`
- `gotchas/drizzle-postgres-js-execute-returns-rows-directly-20260608.md`
- `design-patterns/alert-sweep-does-not-route-through-dispatcher-20260608.md`
- `gotchas/typescript-monorepo-shared-interface-rebuild-before-downstream-typecheck-20260608.md`
- `gotchas/array-index-guard-use-length-not-undefined-check-20260608.md`
- `gotchas/playwright-waitforresponse-must-precede-triggering-click-20260608.md`
- `gotchas/playwright-getbyrole-heading-level-must-match-component-20260605.md` (patched — getByText strict-mode addendum)
