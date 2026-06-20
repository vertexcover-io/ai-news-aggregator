---
name: review-archive
description: >-
  Interactively re-review and edit today's newsletter archive run (the AI News
  Aggregator daily digest) against the production API. Use this whenever the user
  wants to curate, re-review, clean up, re-rank, or polish a daily run / archive /
  digest — e.g. "re-review today's archive", "look at today's selected and
  shortlisted articles and drop the ones that don't fit", "rerank today's news",
  "improve the summaries/headlines for today's digest", "promote some shortlisted
  posts into today's run", "edit item 42's summary", or "add this URL to today's
  newsletter". It finds today's run, pulls the currently SELECTED items plus the
  SHORTLISTED pool, helps the user prune/keep/rerank/edit, can promote pool items
  in (which costs money, so it always confirms first), and saves changes back via
  the API as a draft by default. Trigger even if the user doesn't say "skill" or
  name the run id explicitly — any request to review/curate/edit the day's
  newsletter selection belongs here.
---

# Review Archive

Re-review and edit a daily newsletter run through the production API. The
editorial judgement — which items fit, how to rank them, how to tighten a
summary — is **yours** (Claude's). The API has no "re-shortlist" or "re-rank"
LLM endpoint, so the value of this skill is that *you* do the reasoning and then
push the result. A bundled CLI (`cli.ts`) handles auth and transport; you handle
taste.

## Operating principles

- **Propose, then confirm. Always.** Never write to the archive before showing
  the user a clear diff (keep / remove / rerank / edited text) and getting an
  explicit go-ahead. This run becomes a real newsletter; a silent edit is worse
  than no edit.
- **Draft by default.** Save with `publish: false` unless the user explicitly
  says to publish/send. A draft sets nothing live and enqueues no email/social.
- **Promotion costs money — gate it.** Promoting a pool item calls an LLM to
  generate its recap. Before promoting anything, show the user the candidate
  **headlines + links** and let them pick. Never bulk-promote on a hunch.
- **Full-list semantics.** A `patch` replaces the *entire* selected list. To
  remove an item you omit it; to rerank you reorder; the array order IS the rank.
  Always send the complete intended list, never a partial one.

## The CLI

Run from the repo root (it reads creds from `.env` beside the skill):

```bash
pnpm exec tsx .claude/skills/review-archive/cli.ts <verb> [args]
```

First use needs `.claude/skills/review-archive/.env` (gitignored):

```
REVIEW_API_BASE_URL=https://news.vertexcover.io
REVIEW_ADMIN_EMAIL=you@example.com
REVIEW_ADMIN_PASSWORD=...
```

If that file is missing, the CLI tells the user exactly what to create — relay
that and stop; do not invent credentials. Run `whoami` once to confirm login
works before doing real work.

Verbs (all emit JSON on stdout):

| Verb | Purpose |
|------|---------|
| `whoami` | confirm creds + login |
| `todays-run [--date YYYY-MM-DD]` | resolve the run to review (newest completed, or a date) |
| `snapshot <runId>` | the review payload: selected items + shortlisted pool in one call |
| `pool <runId> [--all] [--limit N]` | pool items (shortlisted-only by default) |
| `patch <runId>` | save edits — pipe a `PatchArchivePayload` JSON on stdin |
| `promote <runId> <rawItemId>` | pull one pool item into the selected list (LLM recap, costs money) |
| `add-post <runId> <url>` | add an external URL as a new item |
| `regen-digest <runId>` | regenerate digest headline/summary; pipe `{items:[...]}` on stdin |
| `runs` / `archive <runId>` | raw escape hatches if you need them |

## Workflow

### 1. Find the run

Run `todays-run`. It returns the newest completed run (or use `--date` if the
user names one). Confirm with the user this is the run they mean (echo the
`issueDate` and whether it's already `reviewed`). If it's already reviewed, warn
that you'll be editing a published issue.

### 2. Pull the snapshot

Run `snapshot <runId>`. You get:
- `selected` — the current `rankedItems`, in rank order. Each has `id`,
  `sourceType`, `title`, `url`, and recap fields (`summary`, `bullets`,
  `bottomLine`, `imageUrl`).
- `shortlistedPool` — shortlisted items **not** currently selected, with
  `id`, `title`, `url`, `engagement`, `recapSummary`.

### 3. Re-review the selected items

Read every selected item and judge it against the rubric below plus anything the
user told you they're optimizing for today. The rubric is the **default**; the
user's steer always wins. Produce, for each item: **keep / remove**, a proposed
**new rank position**, and (if it helps) a **tightened title/summary**.

Editorial rubric (why each matters):
- **On-topic for AI/ML.** The digest is an AI news digest. Off-topic items, even
  great ones, dilute it.
- **Signal over noise.** Prefer substantive developments (releases, research,
  meaningful analysis) over rumor, low-effort hot takes, or pure marketing.
- **Non-redundant.** If two items cover the same story, keep the better one and
  drop the duplicate — note the merge in your diff.
- **Recency / relevance to *this* issue.** Stale or already-covered news ranks
  lower or comes out.
- **Rank by importance.** The most consequential item leads; order reflects what
  a busy AI-focused reader should see first.

For summaries/headlines: make titles crisp and concrete (≤160 chars, the API
limit), summaries skimmable, no hype. Don't rewrite what's already good — edits
should earn their place.

### 4. Review the shortlisted pool (gated promotion)

Look at `shortlistedPool`. Decide which, if any, deserve to be in today's issue.
Then — because promoting costs an LLM call — **present the candidates as a short
list of headlines + links** and ask the user which to promote. Example:

```
Shortlisted candidates worth considering (promotion runs an LLM recap, ~$):
  [a] "Anthropic ships Claude 4.8"   https://…   (HN: 412pts)
  [b] "New paper on MoE routing"     https://…   (reddit: 88pts)
Which should I promote? (a, b, both, none)
```

Only after the user picks do you run `promote <runId> <rawItemId>` per chosen
item. Each returns the hydrated item; fold it into your proposed selected list at
the rank you think fits (re-confirm placement in the diff).

### 5. Show the diff and confirm

Present a single, scannable proposal before touching the archive:

```
PROPOSED REVIEW for <issueDate> (run <runId>) — DRAFT

KEEP & RERANK (new order):
  1. (was 3) "…title…"
  2. (was 1) "…title…"   ✎ summary tightened
  …
REMOVE:
  - "…title…"  — reason (off-topic / duplicate of #2 / stale)
PROMOTE IN:
  + "…title…"  (rank 4)  — from shortlist
EDITS:
  - #2 summary: "<old>" → "<new>"
DIGEST: headline/summary unchanged  (or: propose new)

Save as DRAFT? (or 'publish' to set live)
```

Wait for approval. If the user tweaks, update and re-show. Don't proceed on
ambiguity.

### 6. Save

Assemble the **complete** `PatchArchivePayload` — every item that should remain,
in final order, with any edited fields — and pipe it to `patch`:

```bash
echo '<json>' | pnpm exec tsx .claude/skills/review-archive/cli.ts patch <runId>
```

`PatchArchivePayload` shape (only `id` + `sourceType` are required per item;
include text fields only where you changed them):

```json
{
  "rankedItems": [
    { "id": 42, "sourceType": "hn", "title": "…", "summary": "…",
      "bullets": ["…"], "bottomLine": "…" },
    { "id": 99, "sourceType": "reddit" }
  ],
  "digestHeadline": null,
  "digestSummary": null,
  "publish": false
}
```

- Omit a previously-selected `id` from `rankedItems` to remove it.
- Reorder the array to rerank.
- `rankedItems` must be non-empty — never save an empty issue; if the user wants
  everything gone, stop and confirm that's really intended.
- Leave `publish` false for a draft; set true only on an explicit publish/send.

After saving, report what changed and confirm it's a draft (or published). If
the user later wants to regenerate the digest headline/summary off the final
selection, use `regen-digest` with `{items:[{id,title,summary,bottomLine}]}`.

## Individual edits (no full re-review)

The user may just want one change — "fix item 42's headline", "add this URL",
"drop the third item". You still go through `patch` with the full list (fetch the
current `snapshot` first so you don't drop anything), but skip the full rubric
pass. Confirm the single change, then save as draft.

## When something's off

- **401 / login fails:** the cached session may be stale — the CLI auto-retries
  login once; if it still fails, the creds in `.env` are wrong. Tell the user.
- **No completed run found:** today's run may still be processing or failed.
  Show `runs` output so the user can see run states and pick one with `--date`.
- **`add-post` 502:** the URL couldn't be fetched/enriched upstream. Report it;
  don't retry blindly.
- **Promotion 409:** the item is already in the selected list — skip it.
