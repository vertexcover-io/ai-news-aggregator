# Learnings — improve-summary-our-opinion

## Learning 1: Plan-approval gate caught a real scope issue before code was written

During planning, the initial proposal was to apply the editorial-stance voice change to all four recap fields including `summary`. The plan-approval gate flagged this as scope creep: the summary field's factual ORIENT role ("state what happened, fact-first, ≤25 words") is load-bearing for the archive UI and the Ledger design — the italic serif lede under each story renders `recap.summary` as the first thing a reader sees, so turning it opinionated would break the reading contract.

The gate caught this before any code was written, resulting in a corrected scope: voice-shift applies only to `bullets` and `bottomLine`; `summary` is explicitly excluded and a positive regression guard test (`VS-1c`, `VS-3b`) was added to permanently enforce that boundary.

**Rule:** When a voice/tone change touches a field that is rendered in a specific UI position with a specific reading contract, the scope decision is not just a prompt preference — it has downstream rendering consequences. The approval gate should ask "what does each affected field render as in the UI?" before approving scope.

## Learning 2: Extracting a shared constant is the right pattern for multi-prompt synchronization

The original design had the recap-content instructions duplicated between `rank-prompts.ts` and `recap.ts`. The fix was to extract `RECAP_VOICE_BLOCK` as an exported constant in `rank-prompts.ts` and import it into `recap.ts`. This is preferable to keeping both files in sync manually because: (a) a single edit propagates to both prompts, (b) a test (`VS-3a`) can assert `RECAP_SYSTEM_PROMPT.includes(RECAP_VOICE_BLOCK)` and would fail immediately if the import were removed or the constant drifted, and (c) the import makes the single-source-of-truth relationship explicit in code rather than a convention.

**Rule:** When two prompts must stay in sync (e.g., a batch-ranking prompt and a single-item add-post prompt), extract the shared block into an exported constant and import it. Never rely on manual copy-paste synchronization across files — it always diverges.
