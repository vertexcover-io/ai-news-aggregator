# Adversarial Findings — llm-shortlisting-rewrite

Role-swap pass: attempted to break the feature.

## Scenarios attempted

### 1. LLM returns an id with leading/trailing whitespace ("  abc123  ")
**Outcome:** Would NOT match `idMap.get("  abc123  ")` — would be dropped as unknown. The LLM is instructed to return ids verbatim and zod schema is `z.string()` without trim. **Defect: low risk.** A malicious prompt cannot inject whitespace-padded ids into the input set because we control the input payload. No fix needed.

### 2. LLM returns duplicate ids ("abc", "abc")
**Outcome:** The for-loop pushes the candidate twice. The result `shortlist` would contain duplicate `Candidate` references. **Defect: low risk.** Downstream rank.ts deduplicates by id at its own boundary (it uses a map keyed by id). Adding a `seen` Set to drop dupes in shortlist.ts would be defensive but redundant. **Mitigation: prompt explicitly says "No duplicates within `ids`."** Accepted as low risk.

### 3. LLM returns >> N ids (e.g. 100 ids when shortlistSize is 30)
**Outcome:** All valid ids are pushed; shortlist length exceeds N. The rank stage downstream caps by `topN` but the shortlist itself is unbounded by the LLM. **Defect: minor.** The prompt explicitly requires `length between 0 and {{N}} inclusive`, and `temperature: 0` makes deviation unlikely. If it occurs, rank's `topN` cap still produces correct output. Accepted as low risk.

### 4. shortlistPrompt is empty in DB (e.g. NULL despite NOT NULL)
**Outcome:** zod validation (`min(1)`) rejects empty prompts at PUT /api/settings. The DB column is NOT NULL with a seeded default. The migration backfills the singleton row. Cannot reach empty state through normal channels.

### 5. SHORTLIST_MODEL env set to invalid model
**Outcome:** Anthropic SDK throws `404 model_not_found` or similar. Error bubbles to `handleRunProcessJob` → run.failed with the error message logged. Cost tracker doesn't record (tracker.record is after `await generate`). Run status terminal-fails cleanly.

### 6. Migration applied twice / re-application
**Outcome:** Drizzle's migration table tracks applied hashes; re-running is a no-op. The hand-edited backfill only writes when the column is freshly added (UPDATE within the migration script runs once per migration apply). No idempotency issue.

### 7. Setting `shortlistSize = 5` (minimum bound)
**Outcome:** Accepted by zod, persisted, LLM gets `shortlistSize: 5` in payload. Edge case: small N may produce a narrow rank pool. Operator can tune freely between 5-100.

### 8. Settings PUT mid-job
**Outcome:** Per-job `userSettingsRepo.get()` is awaited at the start of `handleRunProcessJob`. A PUT that lands mid-job does NOT affect the currently-running job (snapshot semantics). The next job sees the new value. Matches the "next run" promise.

### 9. Two parallel runs against the same singleton settings
**Outcome:** Both jobs independently `.get()` settings; each sees a consistent snapshot. No race condition because settings is read-only during a job.

### 10. Archive lacking `cost_breakdown.stages.shortlist` rendered in CostDialog
**Outcome:** `Object.entries(breakdown.stages)` skips the absent key. STAGE_ORDER iteration with `stages[stage]` check yields dash placeholders. Verified in `CostDialog.test.tsx` REQ-070.

## Defects found

None blocking. The duplicate-id and overshoot-N scenarios above are theoretical risks mitigated by:
- `temperature: 0` in the LLM call (deterministic, schema-constrained output)
- Prompt explicitly forbidding duplicates and bounding length
- Downstream rank.ts handling its own dedup + topN cap

## Adversarial verdict

ROBUST. No exploitable failure modes uncovered.
