# `llms/` — generated llm.txt files

These files follow the [llmstxt.org](https://llmstxt.org/) convention so LLMs and AI
agents can consume the AgentLoop newsletter site.

| File | What it is |
|------|------------|
| `llms.txt` | Site index: links to recent published issues, the must-read canon, and the public pages. |
| `llms-full.txt` | Same index with each issue's full content inlined. |
| `canon.llm.txt` | The must-read canon as a standalone document. |
| `issues/<date>-<runId>.llm.txt` | One file per published daily issue. |

## How they're produced

A single generator lives in `@newsletter/shared/llm-txt`. Two consumers call it, so the
served and committed versions never drift:

- **Live API** — the Hono API serves these dynamically:
  - `GET /llms.txt`, `GET /llms-full.txt`
  - `GET /api/archives/:runId/llm.txt` (per issue)
- **This directory** — regenerated from the database with:

  ```bash
  pnpm generate:llm-txt        # from the repo root
  # or: pnpm --filter @newsletter/api generate:llm-txt
  ```

  The script reads published, reviewed issues + the canon, renders them with the shared
  generator, and overwrites the files here. Output is deterministic for a given DB state.

> The committed snapshot in this repo was generated from representative example data so the
> files are reviewable. Run `pnpm generate:llm-txt` against the live database to refresh them.

## Production serving

The web app is a Vite SPA, so the root `/llms.txt` and `/llms-full.txt` paths are served by
the **API**, not the static frontend. In production, route those root paths (and the
per-issue `/api/archives/:runId/llm.txt`) to the API service via your reverse proxy / rewrite.
