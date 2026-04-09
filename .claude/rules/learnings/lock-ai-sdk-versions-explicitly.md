# Pin AI SDK versions exactly and check breaking changes before upgrading

The Vercel AI SDK moves fast and removes APIs between major versions (e.g. v6 deprecated `generateObject`, which v5 still exposes). A loose version range (`^5.0.0`) can silently pull in a major bump on the next `pnpm install` and break code that compiles fine locally.

Rules:
1. Always install `ai` and provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.) with exact versions (no `^`/`~`).
2. Before upgrading the AI SDK, fetch the changelog/migration notes via context7 (`/vercel/ai`) and search the codebase for any deprecated APIs.
3. The core `ai` package and the `@ai-sdk/*` provider packages version **independently** — do NOT assume their majors match. As of 2026, `ai@5.x` ships alongside `@ai-sdk/google@2.x`, `@ai-sdk/openai@2.x`, etc. What must stay aligned is the major version *among* the `@ai-sdk/*` providers with each other, not between providers and the core `ai` package.

Why: In the run-ui run, the phase 4 agent picked up AI SDK v6 by default and had to downgrade to `5.0.169` after `generateObject` failed. Exact pinning + a deliberate upgrade workflow prevents this from recurring. In the custom-eslint-plugin run, Phase 7's SPEC incorrectly stated that `ai` and `@ai-sdk/*` majors must match — this was wrong and the invariant check had to be written to compare providers against each other, not against `ai`. This file was the previous source of the misconception and has been corrected.

Enforced by: tools/check-repo-invariants.ts (ai-sdk-alignment + package-json-pinning). The ai-sdk-alignment check flags major-version drift *among* `@ai-sdk/*` providers, reflecting Vercel's actual versioning model where the core and provider packages version independently.
