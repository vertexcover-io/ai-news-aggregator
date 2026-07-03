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
- **Full-list, full-copy semantics.** A `patch` replaces the entire selected
  list *and every per-item copy override*. Omit an item to remove it; array
  order IS the rank; and any title/summary/bullets/bottomLine you don't resend
  silently reverts to the pipeline recap. Every patch carries the complete
  intended state — never a delta. (Exception: omitted digest fields are
  preserved.)

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

**Sweep for unsent runs.** Check `runs` for earlier completed runs whose issue
was never delivered (`emailSentAt` null) since the last sent one. If any exist,
propose a **combined issue**: their items can be added straight into today's
`rankedItems` — patch validates ids against global `raw_items`, not the run —
carrying their copy from the old archive for free (no promote/add-post).
"Stale/already-covered" means covered in a *sent* issue, not merely a previous
run.

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
- **On-topic for software engineering / coding agents.** This is a *developer*
  digest about building software with AI — not a general AI/ML newsletter. The
  spine is: coding-agent and dev-tool releases (Claude Code, Cursor, Codex,
  Copilot, Devin, LangSmith, GLM/DeepSeek/Grok *as they affect coding*),
  agent-engineering practice, and concrete builder economics (model cost/routing
  for dev work). Prune items that are general AI/ML and **not** about building
  software, even when they're strong: pure RL/training-stability research,
  business-or-product benchmarks (e.g. running-a-company sims), self-improvement
  theory, and inference-serving ops that aren't a developer-facing release. A
  model release is in-scope when it concretely changes coding-agent
  cost/latency/capability; a research paper is in-scope only when it's about
  *practicing* software engineering with agents, not adjacent ML science. When an
  item is borderline (e.g. inference infra that lowers coding-agent cost), keep it
  but rank it low, and surface the call to the user rather than guessing.
- **Rank on one axis: could this change how engineers do agentic coding?**
  High value: opinion/analysis pieces, large model announcements, genuinely new
  tools, skills/lessons/how-to, technical deep dives that build better
  understanding, security disclosures + data insights, builder economics
  (agent cost, harness tuning). Low value even when on-spine: a
  previously-launched model being added to yet another platform, small feature
  dials in existing tools, single-vendor launches without a lesson, funding
  rounds — prune these.
- **Signal over noise.** Prefer substantive developments (releases, research,
  meaningful analysis) over rumor, low-effort hot takes, or pure marketing.
- **Non-redundant.** If two items cover the same story, keep the better one and
  drop the duplicate — note the merge in your diff. When several items are facets
  of *one* development (e.g. a model launch plus each harness that adopted it the
  same day), **merge them into a single story** rather than listing them
  separately — see "Merging items" below.
- **Recency / relevance to *this* issue.** Stale or already-covered news ranks
  lower or comes out.
- **Rank by importance.** The most consequential item leads; order reflects what
  a busy AI-focused reader should see first.

**Polishing the title + summary is a first-class part of the pass, not an
afterthought.** For *every* item you keep, read its title, summary, bullets, and
bottom line and judge them on their own merits — the pipeline's generated copy is
often serviceable but flat, generic, or missing the detail that makes the story
land. Rewrite so that:
- The **title** is crisp, concrete, and *attractive* — it names the actual thing
  that happened and why a builder should care, not a vague category (≤160 chars,
  the API limit). "Cursor Ships Mobile App for Steering Coding Agents From Your
  Phone" beats "Cursor Has a New App."
- The **summary** gives enough context to understand the story without clicking —
  the who/what/number that matters — while staying skimmable and hype-free.
- **Bullets** carry the concrete specifics (numbers, names, availability); the
  **bottom line** says why it matters to someone building software with agents.

Don't rewrite what's already genuinely good — but "already generated" is not the
same as "good enough." Most items benefit from a tighter, more specific pass.
When you promote a pool item, treat its freshly-generated recap the same way:
read it against the source and rewrite anything vague or overclaimed before it
ships.

#### Merging items into one story

Several selected items are often facets of a single development — the classic
case is a model launch plus every coding-agent harness that adopted it the same
day. A digest reads far better with **one** consolidated story than three
near-identical entries. To merge:

1. **Pick an anchor** — keep the id of the strongest/most-canonical item (usually
   the launch or primary source). That id stays in `rankedItems`.
2. **Omit the others** from `rankedItems` entirely (full-list semantics — omitting
   removes them). You do *not* delete them from the run; they simply drop out of
   the selected list.
3. **Rewrite the anchor's recap to absorb the others** — fold the distinct facts
   from each merged item into the anchor's title, summary, and bullets (e.g. one
   bullet per harness with its benchmark number). Send those edited fields in the
   anchor's `rankedItems` entry.
4. **Show the merge explicitly in the diff** — "MERGE: #1 + #2 + #3 → single
   story (anchor id 27599); #2, #3 dropped as standalone" — and list the new
   title/bullets so the user approves the consolidated copy.

Merging needs no promotion (you're editing an already-selected item), so it costs
nothing. It's pure `patch`.

### 4. Review the shortlisted pool (gated promotion)

Look at `shortlistedPool`. Decide which, if any, deserve to be in today's issue.

**Don't stop at the shortlist.** The shortlisted pool is often thin and heavy on
near-duplicates of already-selected items. The genuinely strong candidates —
high-engagement HN threads, primary-source tweets, engineering-blog posts — are
frequently in the *full* pool, not the shortlist. When the shortlist looks
duplicative or the user asks you to "find more" / look at HN / tweets / blogs,
run `pool <runId> --all --limit 100` and scan the whole population for on-spine
items the shortlist missed. Prefer the highest-signal *primary* source when the
same story appears more than once (e.g. a 600-pt HN post over a personal blog
covering the same news).

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

Aim for **one consolidated proposal round**: lineup + copy edits + digest +
promotion candidates together, then execute all writes (add-posts, promotes,
patch) after a single go-ahead. Wait for approval. If the user tweaks, update
and re-show. Don't proceed on ambiguity.

### 6. Save

Assemble the **complete** `PatchArchivePayload` — every item, in final order,
each carrying its full copy — write it to a scratchpad file (`patch.json`) and
pipe it to `patch`:

```bash
cat patch.json | pnpm exec tsx .claude/skills/review-archive/cli.ts patch <runId>
```

**`patch.json` is the running state for the session.** For every later round,
edit that file and resend the whole thing — a patch that omits copy sent
earlier silently reverts those items to pipeline recaps. If resuming without
the file, rebuild it from `snapshot`: send every item's rendered
title/summary/bullets/bottomLine back as explicit overrides, then edit on top.

`PatchArchivePayload` shape (`id` + `sourceType` required; bare entries are
safe only for items never edited):

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

After saving, report what changed and confirm it's a draft (or published).

**Reconcile the digest whenever the selection changed materially.** The
pipeline writes `digestHeadline`/`digestSummary` against the *original* lineup —
after merges/removes/reorders they go stale (name-dropping cut stories, cloning
item #1's title). **Write the new headline + summary yourself** in the same
patch — you hold the full editorial context and it's free. The headline must
frame the issue's theme, never clone the top item's title. `regen-digest` (LLM)
is only a fallback when nobody is writing copy.

## Individual edits (no full re-review)

The user may just want one change — "fix item 42's headline", "add this URL",
"drop the third item". You still go through `patch` with the full list AND full
copy: fetch the current `snapshot`, build the payload with every selected item's
rendered `title`/`summary`/`bullets`/`bottomLine` sent back explicitly, then
apply the one change on top. Skip the full rubric pass. Confirm the single
change, then save as draft.

## When something's off

- **401 / login fails:** the cached session may be stale — the CLI auto-retries
  login once; if it still fails, the creds in `.env` are wrong. Tell the user.
- **No completed run found:** today's run may still be processing or failed.
  Show `runs` output so the user can see run states and pick one with `--date`.
- **`add-post` 502:** the URL couldn't be fetched/enriched upstream. Report it;
  don't retry blindly.
- **`add-post` with a YouTube URL:** succeeds but with a placeholder recap (the
  enricher can't read video pages). Fetch the transcript (video-lens skill),
  hand-write title/summary/bullets/bottomLine, and override them in the patch.
- **Promotion 409:** the item is already in the selected list — skip it.
