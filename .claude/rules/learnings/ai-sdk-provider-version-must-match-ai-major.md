# `@ai-sdk/<provider>` version must match the installed `ai` major — pin the `ai-vN` dist-tag, not `latest`

When adding a new Vercel AI SDK provider package (`@ai-sdk/google`, `@ai-sdk/openai`, etc.) to a
package that already depends on a specific `ai` major, `@latest` will pull the provider built for the
**newest** `ai` major and silently mismatch your installed `ai`. The provider's `LanguageModel` type
and runtime contract won't line up with the `ai` your code calls, causing type errors or runtime
failures that look unrelated to the version skew.

## What bit us

This repo's pipeline runs `ai@5.0.169` + `@ai-sdk/anthropic@2.0.74`. Adding `@ai-sdk/google@latest`
fetched `3.0.79`, which targets `ai@6`. We had to pin the **`ai-v5` dist-tag** instead, which
resolves to `@ai-sdk/google@2.0.74` — matching the installed `ai@5` line and the existing
`@ai-sdk/anthropic@2.0.74`.

## The mapping

The `@ai-sdk/*` provider packages publish a dist-tag per `ai` major:

- `ai@5.x`  → provider `ai-v5` dist-tag (currently the `2.0.x` provider line)
- `ai@6.x`  → provider `latest` (currently the `3.0.x` provider line)

So in an `ai@5` project, **`pnpm add @ai-sdk/google@ai-v5`** is correct; `@latest` is wrong.

## Rule

Before adding any `@ai-sdk/<provider>`:

1. Check the installed `ai` major: `grep '"ai"' packages/<pkg>/package.json`.
2. Match the **already-pinned sibling provider's exact version** if one exists (here:
   `@ai-sdk/anthropic@2.0.74` → use `@ai-sdk/google@2.0.74`).
3. Install via the `ai-vN` dist-tag (`@ai-sdk/google@ai-v5`) or the exact version — never `@latest`
   in a project that isn't on the newest `ai` major.
4. Pin the **exact** version (no `^`/`~`) per repo dependency policy, in the **correct package only**
   (here: pipeline, not shared/api/web).
5. Run a full monorepo `pnpm typecheck` after install — a major mismatch surfaces as a
   `LanguageModel`/provider type incompatibility at the call site, not at install.

## Heuristic

If a freshly-added `@ai-sdk/*` provider throws type errors at `generateObject`/`generateText` call
sites against a model the docs say is supported, suspect a provider/`ai` major mismatch before
suspecting your code. Check that the provider version's `ai` peer matches your installed `ai` major.
