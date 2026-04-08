# Pin AI SDK versions exactly and check breaking changes before upgrading

The Vercel AI SDK moves fast and removes APIs between major versions (e.g. v6 deprecated `generateObject`, which v5 still exposes). A loose version range (`^5.0.0`) can silently pull in a major bump on the next `pnpm install` and break code that compiles fine locally.

Rules:
1. Always install `ai` and provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.) with exact versions (no `^`/`~`).
2. Before upgrading the AI SDK, fetch the changelog/migration notes via context7 (`/vercel/ai`) and search the codebase for any deprecated APIs.
3. Provider packages (`@ai-sdk/*`) and the core `ai` package must move together — mixing major versions across them is unsupported.

Why: In the run-ui run, the phase 4 agent picked up AI SDK v6 by default and had to downgrade to `5.0.169` after `generateObject` failed. Exact pinning + a deliberate upgrade workflow prevents this from recurring.
