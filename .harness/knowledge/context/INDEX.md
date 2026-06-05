---
last_verified_sha: 5a2ff20
status: active
---

# Context Map Index

## Read order

1. **ARCHITECTURE.md** — system shape, package boundaries, module-level traces
2. **DATAFLOW.md** — named cross-package flows, end-to-end traces
3. **DECISIONS.md** — all D-* decision index + cross-package decision bodies
4. **GLOSSARY.md** — domain vocabulary
5. **standards/** — prescriptive rules for how code must be written
6. **packages/** — per-package PACKAGE.md docs (the workhorse tier)

## Package map

| Package | Doc | Role |
|---------|-----|------|
| shared | [PACKAGE.md](packages/shared/PACKAGE.md) | Monorepo foundation: DB schema, types, constants, utilities |
| api | [PACKAGE.md](packages/api/PACKAGE.md) | Hono REST API, auth, job enqueueing, email delivery |
| pipeline | [PACKAGE.md](packages/pipeline/PACKAGE.md) | BullMQ workers: collectors, processors, social posting |
| web | [PACKAGE.md](packages/web/PACKAGE.md) | React + Vite frontend (admin UI + public archive) |
| eslint-plugin | [PACKAGE.md](packages/eslint-plugin/PACKAGE.md) | Custom ESLint rules enforcing architecture |
| scripts | [PACKAGE.md](packages/scripts/PACKAGE.md) | Standalone CLI utilities for OAuth and infra setup |
