# Adversarial findings

Role-swap pass: tried to break the feature with edge cases. Results:

| Attack | Outcome |
|--------|---------|
| `hook = ""` (empty string, not null) | `buildLinkedinPostBody` trims and falls through to constant — verified by composer's `hook.trim() !== ""` branch. Covered by VS-2 / unit. |
| `hook = "   "` (whitespace) | Same fallback path; constant header used. Verified in compose unit suite (`composePosts({ hook: "   " })` no longer returns null after the bail-out relaxation; LinkedIn body uses the constant). |
| 0 ranked items | LinkedIn body is `null`; notifier skips with `no_headline`. Covered by `compose.test.ts::"REQ-11 LinkedIn body is null when no usable stories"` and `notifier.test.ts::"no stories → skipped no_headline"`. |
| Story with valid title but empty summary | Filtered out before slicing; not shown in bullets. Covered by `compose.test.ts::"VS-4 LinkedIn filters whitespace-only summaries before slicing top-5"`. |
| Exactly 5 ranked items | All 5 emitted, none dropped. Covered implicitly by REQ-4 (7 → 5) and REQ-5 (3 → 3); slice(0, 5) is order-invariant at the boundary. |
| 6 ranked items where rank-6 is highest engagement | The composer takes the *first 5 of input array order*, which is the rank order written by the rerank stage. No re-sorting. As designed — `archive.rankedItems` is already in rank order. |
| Web `regenerateDigestMeta` returns `hook: "X"` for an archive whose `values.hook` is already non-empty | The panel discards `meta.hook` and preserves `values.hook`. Covered by the rewritten REQ-016 test. |
| Admin saves an empty header field (intentionally clears it) | `PATCH` body carries `hook: ""` → API normalises (existing behaviour) to null OR empty string; either way `buildLinkedinPostBody` trims to empty and falls back to constant. No regression. |
| Notifier called with `archive.hook = "Admin's custom header"` | Posts with that string as header (precedence `archive.hook → constant`). Verified by notifier happy-path test. |
| Twitter notifier behaviour | Unchanged. Verified by all pre-existing Twitter tests still passing in `compose.test.ts`. |
| Bundle size impact (shared subpath import in web) | `pnpm --filter @newsletter/web build` succeeds with no Node-only module warnings. The shared subpath `@newsletter/shared/constants` already existed and was bundled; adding two more constants + one pure function does not pull DB code into the browser. |
| Pre-existing archive with admin-edited `hook` value | Honored verbatim by `buildLinkedinPostBody`; no migration / backfill needed. |
| Pre-existing archive with LLM-generated `hook` from before the worker change | Honored verbatim until the admin re-reviews. Acceptable — admin override is the source of truth either way. |

## Open risks accepted

- The rerank LLM still emits a `hook` string each run; we pay those tokens and discard the value. **Justification:** changing `digestSchema` / `DIGEST_META_INSTRUCTIONS` / `DEFAULT_RANKING_PROMPT` would force a coordinated migration + drift-test fixture update + live `user_settings.ranking_prompt` re-seed. Out of scope. Documented in design.md "Design > Header storage".

## No defects found.
