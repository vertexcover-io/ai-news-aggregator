# `llms/` — llm.txt generation target

The llm.txt files ([llmstxt.org](https://llmstxt.org/) convention) are **served dynamically by
the API** and are **not committed** — they're derived entirely from the database, so a checked-in
copy would go stale the moment a new issue publishes. This directory is only a *target* for the
optional materialization script; its generated outputs are gitignored.

## Source of truth: the live API

The API serves always-current versions (web is a Vite SPA, so these are API routes, not static
frontend assets):

- `GET /llms.txt` — site index (recent published issues, the must-read canon, public pages)
- `GET /llms-full.txt` — same index with each issue's full content inlined
- `GET /api/archives/:runId/llm.txt` — one published issue

In production, route the root paths (`/llms.txt`, `/llms-full.txt`) to the API service via your
reverse proxy / rewrite.

## Optional: materialize files on demand

If you need the files on disk (e.g. to serve from a CDN without the API in the loop):

```bash
pnpm generate:llm-txt        # from the repo root
# or: pnpm --filter @newsletter/api generate:llm-txt
```

This reads published, reviewed issues + the canon from the DB and writes:

```
llms/llms.txt
llms/llms-full.txt
llms/canon.llm.txt
llms/issues/<date>-<runId>.llm.txt
```

The script and the live endpoints share the same generator (`@newsletter/shared/llm-txt`), so
materialized files are byte-identical to served responses. The outputs are gitignored — regenerate
them whenever you need a fresh copy rather than committing them.
