---
id: S-pipeline
applies_to: ["packages/pipeline/src/**"]
enforced_by: eslint
decisions: [D-051]
last_verified_sha: 40c6b83
status: active
---

# Pipeline standards

## S-pipeline-01 — No HTTP framework

**Rule:** The pipeline is a standalone Node process running BullMQ workers. It must not import `hono`, `express`, or `@newsletter/api`.

**Enforced by:** eslint `no-restricted-imports` (severity: `error`, fails CI)

**Smell:** `import { Hono } from "hono"` or `import ... from "@newsletter/api"` in any pipeline file.

## S-pipeline-02 — Collector return shape

**Rule:** Every collector function must return `CollectorResult` (from `@newsletter/shared/types`), not a raw array.

**Enforced by:** eslint `newsletter/collector-return-shape` (severity: `error`, fails CI)

**Smell:** A collector function whose return type annotation is `RawItemInsert[]` or `Promise<RawItemInsert[]>`.

## S-pipeline-03 — Per-job credential resolution

**Rule:** Social/email publish dependencies AND collector-health probe dependencies (Twitter collector cookie, TAVILY_API_KEY) must be resolved per job, not at worker startup. Credential changes must take effect on the next job without a worker restart. The collector-health worker fulfills this via the `buildHealthCheckDeps()` async factory called inside `handleCollectorHealthJob` (D-051 pattern; D-110 worker).

**Enforced by:** convention (not linted; enforced by D-051 design contract)

**Smell:** `const linkedinClient = createClient(creds)` at module scope or in the Worker constructor; `buildHealthCheckDeps()` (or any credential resolve) hoisted to `buildDefaultCollectorHealthDeps`'s outer scope instead of inside the per-job factory closure.
