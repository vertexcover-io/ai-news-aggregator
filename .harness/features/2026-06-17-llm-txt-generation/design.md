# Design: llm.txt / llms.txt Generation

**Date:** 2026-06-17
**Status:** Approved (auto mode)
**Feature dir:** `.harness/features/2026-06-17-llm-txt-generation/`

## Problem

We want the AI Newsletter site to be first-class consumable by LLMs and AI crawlers via the
[llmstxt.org](https://llmstxt.org/) convention. Concretely:

1. **Per-issue file** — every published daily digest gets an `llm.txt` rendering of that issue
   (headline, summary, ranked stories with URLs + recaps).
2. **Site index (`llms.txt`)** — a root index file describing the site and linking to: all
   published issues (the archive), the canon / must-read reading list, the "How we build it"
   page, and the other public pages.
3. **A full-content variant (`llms-full.txt`)** — the expanded form per the spec, inlining issue
   content rather than just linking.
4. **Materialize generated files into the repo** — the generated `.txt` files are also committed
   to a tracked directory so they're versioned and diffable, not only served dynamically.

## Vocabulary (this codebase)

- **Run / archive** — a row in `run_archives`. Public iff `reviewed = true AND is_dry_run = false`.
- **Issue date** — derived: `publishedAt ?? startedAt ?? completedAt`, formatted in the configured tz.
- **Ranked items** — `rankedItems: RankedItemRef[]` on the archive; hydrated against `raw_items`
  to produce title / url / summary / bullets / bottomLine.
- **Canon** — the "must-read" curated reading list (`must_read` table → `/api/must-read`,
  `MustReadPage`). The user's "canon" = this list.
- **"How we build"** — `BuiltPage.tsx` (the harness-engineering manifesto + pipeline explanation),
  served at `/`. Static content, lives in the SPA.

## Key architectural facts driving the design

- **Web is a pure Vite SPA** — no SSR, no per-route static text. Therefore **all `.txt` endpoints
  must be served by the Hono API**, not the web package. (Confirmed: `packages/web/src/App.tsx`
  uses `createBrowserRouter`; no server rendering.)
- **DB is the source of truth** for issues + canon. Static-page prose ("How we build", site
  description) is content we author in code.
- **Repository factory pattern** — DB access only via `src/repositories/**`. The generator must
  receive already-fetched data (or repos), never import drizzle directly.
- **No existing plain-text serving** — `c.text(...)` / custom Content-Type is new but trivial in Hono.
- **`resolveBaseUrls(env)`** (`packages/api/src/lib/base-urls.ts`) gives the public web base URL for
  building absolute links (`webBaseUrl` from `NEWSLETTER_BASE_URL ?? BASE_URL`).

## Chosen approach: one generator, two consumers

The risk with "serve dynamically" **and** "commit files to the repo" is divergence — two code
paths producing subtly different text. We avoid that with a **single pure content generator** and
two thin consumers:

```
                 ┌─────────────────────────────────────────────┐
                 │  @newsletter/shared/llm-txt  (pure functions) │
                 │  renderIssueLlmTxt(issue)                     │
                 │  renderIndexLlmsTxt(site, issues, canon, …)   │
                 │  renderIndexLlmsFullTxt(...)                  │
                 │  renderStaticPagesSection(...)                │
                 └─────────────────────────────────────────────┘
                          ▲                         ▲
        (fetch via repos) │                         │ (fetch via repos)
                          │                         │
        ┌─────────────────┴───────┐   ┌─────────────┴──────────────────┐
        │  API routes (Hono)       │   │  Materialization script         │
        │  GET /llms.txt           │   │  scripts/generate-llm-txt.ts    │
        │  GET /llms-full.txt      │   │  writes ./llms/*.txt to repo    │
        │  GET /archive/:id/llm.txt│   │  invoked post-publish + manual  │
        └──────────────────────────┘   └─────────────────────────────────┘
```

### Why a shared pure module (not API-only)

- The generator is **data-in / string-out** — no I/O, no DB, trivially unit-testable.
- Both the live HTTP endpoint and the repo-snapshot script call the *same* functions, so the
  committed files are byte-identical to what the API serves. No Potemkin second renderer.
- Lives in `@newsletter/shared` because it's used by 2+ packages (api + a script/pipeline).
  It only needs **types** (`RankedItem`, `PublicMustReadEntry`, issue meta) + a base URL — no DB
  client — so it's browser-safe and import-rule-clean.

### Caching (version-keyed Redis)

Each endpoint caches its rendered text in Redis under a **content signature** so identical content
isn't regenerated on every request (the full index hydrates up to 30 issues — the expensive path).
The key is `variant | baseUrl | scope | issue-signatures | canon-signatures`, where an issue
signature is `runId:completedAt:draftSavedAt` and a canon signature is `id:addedAt`. When a new
issue publishes, a published issue is edited (bumps `draftSavedAt`), or canon changes, the signature
changes → the next request regenerates exactly once and caches under the new key. The cheap metadata
(`listReviewedRows` + `listPublic`) is queried to build the signature; the expensive hydration +
render only runs on a cache miss. The cache is **optional** (DI: absent in unit tests without Redis)
and **fail-open** (a Redis error is logged and the response still renders). A 24h TTL is a backstop;
the version key is the real invalidation mechanism. No manual cache-busting from publish code.

### Endpoints (all public, `text/plain; charset=utf-8`)

| Route | Content |
|---|---|
| `GET /llms.txt` | Site index: H1 title, blockquote summary, sections linking Issues (recent N), Canon, How-we-build, Sources, Archive. Absolute URLs. |
| `GET /llms-full.txt` | Same index but issue content inlined (full digest + stories). |
| `GET /api/archives/:runId/llm.txt` | One issue rendered to llm.txt. 404 if not reviewed. |
| `GET /llms.txt` etc. mounted at **root** (not `/api`) | llmstxt.org expects `/.well-known`-style root paths; we serve at site root via API. |

Note: because web is a SPA served separately in prod, the deployment must route `/llms.txt`,
`/llms-full.txt` to the API. For the MVP/dev the API owns these paths directly; production routing
(reverse proxy / Vercel rewrite) is an ops concern noted in the spec, not code here. The
per-issue file lives under `/api/archives/:runId/llm.txt` which is already API-routed.

### Repo materialization strategy (the "best strategy" question)

Options considered:

- **(A) Pipeline writes + auto-commits from a worker** — rejected: pipeline workers shouldn't do
  git operations; commits from a long-running worker are fragile and surprising.
- **(B) Dynamic-only, never committed** — rejected: the user explicitly wants files in the repo.
- **(C) A standalone generation script** that fetches from the DB and writes `./llms/*.txt` into a
  tracked directory, runnable (i) manually, (ii) from CI on a schedule, and (iii) optionally
  invoked at the end of a publish. **Chosen.**

Generation target (gitignored — see "Decision update" below):

```
llms/
  llms.txt                      # site index
  llms-full.txt                 # full-content index
  issues/
    <issue-date>-<runId>.llm.txt   # one per published issue
  canon.llm.txt                 # the must-read list
```

The script is the single writer. It's deterministic (same DB state → same bytes), so re-running is
idempotent. Because both the script and the live endpoints call the shared generator, materialized
files are byte-identical to served responses.

### Decision update (post-review)

The generated `.txt` files are **not committed**. They're derived entirely from DB rows, so a
checked-in copy goes stale the moment a new issue publishes, while the dynamic endpoints are always
current — committing them duplicates the endpoints and adds a staleness burden for no benefit (the
deployment serves them from the API, not from static files). We therefore:

- keep the **dynamic endpoints** as the source of truth,
- keep the **`generate:llm-txt` script** for on-demand materialization (e.g. CDN static hosting),
- **gitignore** the generated outputs under `llms/`, tracking only `llms/README.md` +
  `llms/.gitignore`.

Wiring it into "every day's run": add an **npm script** `generate:llm-txt` and call it from the
existing post-publish path *if* that path already runs in an environment with repo write access;
otherwise it runs as a scheduled CI job. For this PR we ship the script + endpoints + tests and a
committed initial snapshot generated from local/seed data; the cron/CI wiring is documented as a
follow-up ops step (kept out of code to avoid an untestable git-in-worker dependency).

## External Dependencies & Fallback Chain

**None.** This feature introduces no new external libraries or services. It uses:
- Hono (already present) for `c.text()` / `c.body()` with a custom Content-Type — built-in.
- Existing repositories for data access.
- Node's `fs`/`path` (built-in) in the generation script.

Because there are zero new external deps, the library-probe gate is **NOT_APPLICABLE**.

Fallback chain: n/a.

## Out of scope

- Production reverse-proxy/Vercel rewrite config for root `/llms.txt` (ops, documented only).
- Authenticated/admin llm.txt variants.
- Automated daily git commit from the pipeline worker (documented as CI follow-up).
- robots.txt / sitemap.xml (related but separate; can reuse the same root-serving pattern later).

## Acceptance (high level)

1. `GET /llms.txt` returns 200, `text/plain`, valid llmstxt.org structure (H1, `>` summary, `##`
   sections with `[label](absolute-url)` links).
2. `GET /api/archives/:runId/llm.txt` returns the issue's digest + stories for a reviewed run;
   404 for unreviewed/missing.
3. `GET /llms-full.txt` inlines issue content.
4. The shared generator is pure and unit-tested (issue render, index render, canon render, empty
   states, URL absolutization).
5. `pnpm --filter @newsletter/api generate:llm-txt` (or root script) writes the `llms/` tree; output
   is byte-identical to the corresponding endpoint responses (verified by a test that compares
   generator output used by both).
6. Canon, "How we build", and other public pages appear as linked sections in the index.
