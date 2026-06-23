# Verification Stubs (VS-0) — from library-probe

These probe scripts are re-run by functional-verify to confirm the Apify dependency
still works end-to-end at PR time.

### VS-0-apify-listing: Library probe — subreddit listing via apify-client
**Type:** api
**Run:** bash .harness/runtime/reddit-collector-apify/probes/apify-client/probe.sh
**Expected:** exit 0; listing run returns ≥1 post grouped by subreddit with real
`upVotes`/`numberOfComments`; single-post run returns the requested post (`parsedId`
match). Requires `APIFY_API_KEY` in `.env.harness`.

**Notes for verifier:** actor runs are slow (~60–120s each, Puppeteer + transient 403
retries on RESIDENTIAL proxy). Allow generous timeouts. Each run stores a few pay-per-
result items (~$0.004/result) — negligible cost.
