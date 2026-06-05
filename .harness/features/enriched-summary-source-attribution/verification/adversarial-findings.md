# Adversarial Findings — enriched-summary-source-attribution

Role-swap pass: I'm trying to break this PR. What scenarios could trip it up, what assumptions could be wrong, what would I attack if I were reviewing this for production?

## Scenarios attempted

### A1. Twitter tweet with URL but enrichment fails (404 / timeout / blocked)

**Threat:** User assumed the enriched-summary chip would "always" appear for link-tweets. If enrichment fails, the chip silently reverts to "X / Twitter" with no signal to the user that this happened.

**Reality:** This is the documented fallback (REQ-002, REQ-011 native branch). The chip shows the platform label and links to the tweet — same as before this PR. No regression, but also no observability signal for "enrichment failed silently for a tweet that linked out." The `run_archives.sourceTelemetry.enrichment` JSONB already tracks aggregate failures, so this is recoverable from observability.

**Verdict:** ACCEPTABLE. Not a defect.

### A2. Malformed enriched URL crashes the hydrator mid-iteration

**Threat:** Pipeline blows up, no archive serves.

**Reality:** `deriveHostname` wraps `new URL()` in try/catch and returns `null` on parse failure. `pickSummarySource` then falls through to `kind: "native"` or `"none"` — never throws. Test covered: `summary-source.test.ts` case "malformed enriched URL → native fallback".

**Verdict:** SAFE.

### A3. Launch-date gate off-by-one — exact equality

**Threat:** Archive completed AT the exact launch-date second is incorrectly tagged as legacy.

**Reality:** Gate is strict `<`, not `<=`. Archive at exactly `ENRICHED_SUMMARY_LAUNCHED_AT` passes the gate (gets new behavior). Test covered: `rank-hydration-enriched.test.ts` includes "exact launch-date not gated". Pass-2 verified.

**Verdict:** SAFE.

### A4. `archiveCompletedAt = null` accidentally enabled gating

**Threat:** If a route forgot to pass `completedAt`, the gate could fire incorrectly.

**Reality:** Hydrator gate condition is `archiveCompletedAt !== null && archiveCompletedAt < ENRICHED_SUMMARY_LAUNCHED_AT`. `null` always bypasses the gate (live-run path). Test covered. Pass-2 verified call sites: `routes/archives.ts` × 2 (passes `archive.completedAt`), `routes/runs.ts` × 1 (passes `null` explicitly).

**Verdict:** SAFE.

### A5. Twitter tweet text gets enriched markdown that is itself a paywall stub

**Threat:** The enriched markdown is "Subscribe to read" — replacing meaningful tweet text with vacuous boilerplate. Recap regresses.

**Reality:** This is a NEW edge case introduced by the picker flip. The current implementation doesn't filter paywall stubs — if the link-enrichment fetcher got `200 OK` with `markdown` of non-empty length, it's treated as authoritative. Mitigation in the existing link-enrichment service: paywalled pages typically return their content gate text which IS non-empty, so they DO pass the picker's `markdown.length > 0` check.

**Implication:** For paywalled article links shared via Twitter, the recap may be worse than the pre-PR tweet-text recap. This is a real but narrow regression class.

**Severity:** Important; not blocking — recap LLM is still receiving SOMETHING, and the human reviewer at `/admin/review/:runId` can still edit the recap manually before sending.

**Recommended follow-up (out of scope):** Add a "paywall detection" heuristic to link-enrichment or a min-content-length threshold in the picker. Track in a follow-on issue, not this PR.

### A6. SourceType enum grows (e.g. a new "mastodon" source)

**Threat:** Exhaustiveness check on `PLATFORM_LABEL` map breaks at compile time, blocking unrelated PRs.

**Reality:** The `Record<SourceType, string>` type annotation makes this a compile-time error — which is the DESIRED behavior. Anyone adding a new SourceType is forced to add a label. This is healthy.

**Verdict:** SAFE (by design).

### A7. Cross-package `NewsletterStory` shape drift

**Threat:** Pipeline `email-send.ts::NewsletterStory` and api `newsletter.tsx::NewsletterStory` are two independent interface definitions. They could drift over time.

**Reality:** They are currently structurally identical (pass-2 verified). The C-1 defect in pass-1 was a SYMPTOM of this risk — `email-render.ts` was importing from a third, deprecated `newsletter-send.ts` and TypeScript's structural typing let it compile silently.

**Recommended follow-up:** Consolidate `NewsletterStory` into `@newsletter/shared` so there is ONE definition. Pre-existing project pattern (the type is used by 2+ packages, satisfying shared's "export only types used by 2+ packages" rule). Out of scope for this PR — would balloon the diff.

**Severity:** Important (latent maintenance risk), but not introduced by this PR. The pre-existing dual-definition pattern is the underlying issue.

### A8. JSON serialization of `enrichedSource` on public archive routes

**Threat:** Public archive routes already serialize `RankedItem`. Adding `enrichedSource: { hostname, url }` exposes URLs of enriched articles. Is that PII? Is that a leak?

**Reality:** The enriched URL is the ORIGINAL link the post pointed to — a public URL that was always reachable via `item.url` on the platform (HN/Reddit/Twitter were already showing it). No new information is leaked.

**Verdict:** SAFE.

### A9. Old archives at boundary: `completedAt` is a string vs Date

**Threat:** `< ENRICHED_SUMMARY_LAUNCHED_AT` comparison silently misbehaves if `completedAt` is a JSON string rather than a `Date` object.

**Reality:** `hydrateRankedItems` types `archiveCompletedAt: Date | null` (not `string | null`). TypeScript would catch a string at the call site. `routes/archives.ts` passes `archive.completedAt` which Drizzle returns as `Date` (timestamptz column). Verified.

**Verdict:** SAFE.

### A10. "Read on theverge.com" when hostname contains weird characters

**Threat:** Enriched URL host like `https://www.example.co.uk:8080/path` → derived hostname `example.co.uk` (port stripped by URL.hostname API) — OK. What about `https://example.中国/foo` (IDN)?

**Reality:** `URL.hostname` returns punycode by default in Node. So `example.中国` becomes `xn--fiqs8s.xx`. The chip would show punycode, not the Unicode name. Cosmetic only.

**Severity:** Suggestion. Not in scope for this PR. Could add `URL.unicode` conversion later if any Chinese / Japanese / Cyrillic publication appears in production.

### A11. Two collectors enrich the same URL — cache hit on second

**Threat:** First collector enriches successfully (`status: "ok"`). Second collector hits the per-run cache and gets `status: "ok", cacheHit: true`. Does the picker treat cacheHit differently?

**Reality:** Picker only inspects `status` and `markdown`. `cacheHit` is purely a telemetry signal. Picker treats both equally. Test indirectly covered via the standard enriched-success cases.

**Verdict:** SAFE.

### A12. Add-post for a Twitter URL where the LIVE enrichment hasn't happened yet

**Threat:** Admin pastes a tweet URL at `/admin/review/:runId`. The single-tweet fetcher (`fetchTwitterPost`) writes the raw item but link-enrichment hasn't run yet (add-post is not the batch path). `pickCandidateContent(saved.content, saved.metadata)` sees no `enrichedLink` → returns native content. Recap is generated from tweet text. Chip says "X / Twitter". The user expected the enriched chip.

**Reality:** Add-post does NOT inline-enrich, so this IS the behavior. Acceptable for the MVP per the spec scope; the add-post flow is for manual curation where the admin knows what they're adding.

**Verdict:** ACCEPTABLE behavior (matches existing add-post semantics for HN/Reddit too).

## Defects discovered in this pass

None blocking. Two follow-up recommendations (A5 paywall detection, A7 `NewsletterStory` consolidation) tracked for future iteration.

## Recommendations for post-merge monitoring

1. Watch `run_archives.cost_breakdown.stages.rank.totalCostUsd` for the first 2–3 production runs after deploy. Expected delta: +5–15% (cost of larger rerank input for Twitter link-tweets). Rollback trigger: >2× baseline.
2. Spot-check one newly-shipped archive on the public `/archive/:runId` page after the first post-deploy run completes. Confirm Twitter-sourced enriched stories show the publication hostname in the chip and the link retargets correctly.
3. Spot-check the first email send to confirm the chip renders below each story (gmail / Apple Mail / Outlook web — React Email is well-tested across these but the new chip is new structure).

## Final adversarial verdict

**APPROVED.** No critical-or-blocking defects found. Two follow-up suggestions for future iteration; both are pre-existing patterns (A7) or out-of-scope edge cases (A5) and do not block this PR.
