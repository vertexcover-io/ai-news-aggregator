# Feature: llm.txt / llms.txt Generation

**Verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)

Generates [llmstxt.org](https://llmstxt.org/)-format files so LLMs and AI agents can consume the
AgentLoop newsletter site: a per-issue `llm.txt` for every published daily digest, a site index
(`llms.txt`) and full-content index (`llms-full.txt`) linking issues + the must-read canon + the
"How we build it" page + the other public pages, all served live by the API **and** materialized
into a tracked `llms/` directory via a single shared generator (so served and committed versions
never drift).

## Artifacts

| Doc | What |
|-----|------|
| [design.md](design.md) | Problem, architecture (one generator / two consumers), repo-materialization strategy |
| [spec.md](spec.md) | EARS requirements (REQ-1..13) + verification scenarios (VS-1..8) |
| [plan.md](plan.md) | 4-phase TDD plan |
| [verification/proof-report.md](verification/proof-report.md) | Quality-gate output, scenario coverage, review fixes |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Break attempts + outcomes |

## Library probe

NOT_APPLICABLE — the feature introduces zero new external dependencies.

## What shipped

- `@newsletter/shared/llm-txt` — pure generator (`renderIssueLlmTxt`, `renderIndexLlmsTxt`,
  `renderIndexLlmsFullTxt`, `renderCanonLlmTxt`, `absoluteUrl`).
- API: `GET /llms.txt`, `GET /llms-full.txt`, `GET /api/archives/:runId/llm.txt` (public).
- **Version-keyed Redis cache** — renders are cached until the underlying data changes; no manual
  busting. Fail-open and optional (DI). Unit + e2e tested.
- `RunArchivesRepo.listReviewedRows(limit)` — SQL-level reviewed/non-dry-run fetch.
- `pnpm generate:llm-txt` — optional on-demand materialization script writing the `llms/` tree.
- `llms/README.md` + `llms/.gitignore` (generated outputs are NOT committed — they're served live).

PR: https://github.com/vertexcover-io/ai-news-aggregator/pull/286
