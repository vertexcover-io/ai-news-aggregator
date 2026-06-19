# Verification Stubs (VS-0) — library probes

> Promoted from library-probe. `functional-verify` re-runs these at the end of the pipeline.
> All require keys in project-root `.env.harness` (gitignored); run `set -a; source .env.harness; set +a` first.
> Until keys are present these are UNTESTABLE (see library-probe.md → Setup Needed), not failing.

### VS-0-resend-domains: Library probe — Resend Domains API (per-tenant verification)
**Type:** api
**Run:** `node .harness/runtime/multi-tenant/probes/resend/probe-domains.mjs`
**Expected:** exit 0; prints `{ id, status, records }` where status ∈ {pending, verified, …} and records ≥ 1

### VS-0-tavily-search: Library probe — Tavily search (source discovery)
**Type:** api
**Run:** `node .harness/runtime/multi-tenant/probes/tavily/probe-search.mjs`
**Expected:** exit 0; prints a non-empty array of candidate URLs

### VS-0-twitter-oauth2: Library probe — Twitter OAuth2 authorize link (per-tenant posting)
**Type:** api
**Run:** `node .harness/runtime/multi-tenant/probes/twitter/probe-oauth2.mjs`
**Expected:** exit 0; prints `OK authorize-url generated` (valid OAuth2 authorize URL produced from app client creds)
