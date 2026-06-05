# Code Health GitHub Workflow — Design Spec

**Linear issue:** VER-44
**Date:** 2026-04-06

## Problem

Tech-debt, stale docs, and test coverage gaps accumulate over time. Currently there's no automated way to detect and fix these — someone has to manually run skills in a Claude Code session. Ritesh asked for a one-click GitHub workflow that runs these skills and generates PRs with fixes.

## Solution

A single manually-triggered (`workflow_dispatch`) GitHub Action that runs tech-debt, docs-sync, and coverage skills. Each skill generates a report, hands it to orchestrate (auto mode) to fix, and creates its own PR against `main`.

## Workflow

```
Trigger (manual via workflow_dispatch)
  │
  │  Input: skill selector (choice: all | tech-debt | docs | coverage)
  │
  ├─ if tech-debt selected:
  │    branch off main → run tech-debt-finder → report → orchestrate (auto) → commit → PR
  │
  ├─ if docs selected:
  │    branch off main → run docs-sync → report → orchestrate (auto) → commit → PR
  │
  ├─ if coverage selected:
  │    branch off main → run coverage-guard → report → orchestrate (auto) → commit → PR
```

When `all` is selected, all three run sequentially — each branching off `main` independently, each creating its own PR.

## Design Decisions

### Single workflow with input selector
One `.github/workflows/code-health.yml` file with a `choice` input offering 4 options: `all`, `tech-debt`, `docs`, `coverage`. This gives both "run everything" convenience and per-skill granularity.

### Sequential execution
Skills run one at a time within a single job. This avoids parallel runner costs and keeps things simple. Even when running `all`, the skills execute sequentially.

### Separate PRs per skill
Each skill creates its own branch and PR. This keeps reviews focused — a tech-debt PR only has tech-debt fixes, docs PR only has doc updates, etc.

### Each skill branches off main independently
No chaining between skill branches. Each starts fresh from `main`. If tech-debt fixes something that affects docs, the next docs-sync run will catch it.

### Uses claude-code-action
Same `anthropics/claude-code-action@v1` pattern as the existing `claude.yml`. Reuses the harness plugin setup. The prompt instructs Claude to run the selected skill, feed the report to orchestrate in auto mode, and commit results.

### Orchestrate in auto mode
No human-in-the-loop during the fix phase. The skill generates a report, orchestrate picks it up and fixes everything autonomously.

### Skip if no changes
If a skill finds nothing to fix (or orchestrate produces no code changes), skip the commit and PR creation for that skill entirely. No empty PRs.

### No cron schedule
Manual trigger only for now. Cron scheduling (e.g., weekly Friday evening runs) is a future enhancement — not included in this implementation.

## Files

- **New:** `.github/workflows/code-health.yml`

## Out of Scope

- Cron/scheduled triggers
- Slack notifications for completed runs (tracked separately)
- Third-party code reviewer integration
- Self-review step in orchestrate (tracked as VER-45)
