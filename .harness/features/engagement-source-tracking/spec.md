# SPEC: Engagement Source Tracking

**Source:** .harness/features/engagement-source-tracking/design.md
**Generated:** 2026-06-09

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall provide a single shared helper `withUtmSource(url, source)` in `@newsletter/shared` that returns the input URL with a `utm_source` query parameter set to `source`. | Given `("https://h/archive/x", "linkedin")`, returns a URL whose `utm_source` query value is `linkedin`; the path `/archive/x` is unchanged. | Must |
| REQ-002 | Ubiquitous | The system shall constrain the `source` argument to the fixed set `email` \| `linkedin` \| `twitter` via a TypeScript union/const exported from `@newsletter/shared`. | The `UtmSource` type admits exactly `"email"`, `"linkedin"`, `"twitter"`; passing any other literal is a compile error. | Must |
| REQ-003 | Event-driven | When the pipeline builds the email digest archive links (ribbon CTA and footer/home link), the system shall tag them with `utm_source=email`. | The archive ribbon URL and footer/home URL emitted by the email render carry `utm_source=email`. | Must |
| REQ-004 | Event-driven | When the pipeline builds the LinkedIn archive URL, the system shall tag it with `utm_source=linkedin`. | The URL posted by the LinkedIn notifier carries `utm_source=linkedin`. | Must |
| REQ-005 | Event-driven | When the pipeline builds the X/Twitter archive URL, the system shall tag it with `utm_source=twitter`. | The URL posted by the Twitter notifier carries `utm_source=twitter`. | Must |
| REQ-006 | Ubiquitous | The helper shall preserve the URL's existing path, any existing query parameters, and correct encoding (no string concatenation that can produce malformed URLs). | For a base with a trailing slash and for a URL with a pre-existing query param, the output is a single well-formed URL with exactly one `utm_source` and all prior params intact. | Must |
| REQ-007 | Event-driven | When a reader loads the archive page from a tagged link, the analytics layer shall record the visit with the matching `utm_source` value. | A `$pageview` captured by posthog-js from `…/archive/<uuid>?utm_source=linkedin` carries `utm_source: "linkedin"` (proven by VS-0 probe). | Must |
| REQ-008 | Unwanted | If PostHog is disabled or unreachable, then the system shall still emit valid tagged links and shall not throw from link construction. | With analytics uninitialized, `withUtmSource` returns a valid URL and no notifier path throws; capture is simply absent. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Base URL has a trailing slash (`https://host/archive/x/`) | Output has exactly one `utm_source` param and no malformed/doubled separators | REQ-006 |
| EDGE-002 | Target URL already carries a query string (e.g. `?token=abc`) | `utm_source` is appended as an additional param; the existing `token=abc` is preserved | REQ-006 |
| EDGE-003 | Per-item external article links in the email | NOT tagged — left exactly as-is (untrackable third-party domains) | REQ-003 |
| EDGE-004 | Direct visit (no `utm_source` in URL) | `$pageview` is recorded with no `utm_source` (PostHog `(none)` bucket = direct) | REQ-007 |
| EDGE-005 | `withUtmSource` called with a malformed/relative base | Helper handles via the `URL` API; given the operator-configured absolute base it always produces a valid absolute URL | REQ-006 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_withUtmSource_sets_source_param | pure string/URL logic | `@newsletter/shared` |
| REQ-002 | unit | test_REQ_002_UtmSource_type_is_fixed_set | type-level; assert const set membership at runtime | shared |
| REQ-003 | unit | test_REQ_003_email_archive_links_tagged_email | render output is pure given inputs | pipeline email-render unit |
| REQ-004 | unit | test_REQ_004_linkedin_url_tagged_linkedin | notifier composes URL deterministically | pipeline linkedin notifier unit |
| REQ-005 | unit | test_REQ_005_twitter_url_tagged_twitter | notifier composes URL deterministically | pipeline twitter notifier unit |
| REQ-006 | unit | test_REQ_006_withUtmSource_preserves_path_and_query | pure logic | shared |
| REQ-007 | e2e | test_REQ_007_posthog_captures_utm_source | requires real posthog-js capture (VS-0 probe) | re-runs probe script |
| REQ-008 | unit | test_REQ_008_link_build_never_throws_when_analytics_off | pure logic; link build independent of analytics state | shared |
| EDGE-001 | unit | test_EDGE_001_trailing_slash_base_single_param | pure logic | shared |
| EDGE-002 | unit | test_EDGE_002_existing_query_preserved | pure logic | shared |
| EDGE-003 | unit | test_EDGE_003_external_item_links_untagged | assert email render leaves `story.url` untouched | pipeline email-render unit |
| EDGE-004 | e2e | test_EDGE_004_direct_visit_has_no_utm_source | covered by probe (no-utm URL → no utm_source) | extend VS-0 probe |
| EDGE-005 | unit | test_EDGE_005_absolute_base_always_valid_url | pure logic | shared |

## Verification Scenarios

### VS-1: Reader clicks a digest link (channel attribution)
1. Pipeline publishes a digest → inspect emitted links → each archive link carries `?utm_source=<channel>` (`email`/`linkedin`/`twitter`).
2. Load `https://…/archive/<uuid>?utm_source=linkedin` in a browser → the archive page renders normally (no visible change).
3. PostHog records a `$pageview` with property `utm_source = "linkedin"` and `$pathname = /archive/<uuid>`.

### VS-2: Operator reads the breakdown (PostHog UI)
1. Open the PostHog insight: event `$pageview`, broken down by `utm_source`.
2. Buckets shown: `linkedin`, `twitter`, `email`, and `(none)` (= direct) over the selected window.
   (Manual/documented — the dashboard is PostHog-side config, not app code.)

### VS-0-posthog-js-utm-capture: Library probe — posthog-js utm_source capture
**Type:** api
**Run:** bash .harness/runtime/engagement-source-tracking/probes/posthog-js/probe-utm-capture.sh
**Expected:** exit 0; stdout JSON has `"ok": true` and `sample.utm_source == "linkedin"`; `sample.$pathname` is the archive path (no query). Proves posthog-js auto-captures `utm_source` from the landing URL onto a `$pageview` with no network egress (event dropped via `before_send`).

## Out of Scope

- No in-app analytics UI — the dashboard lives in PostHog's own UI (we document the insight spec).
- No tracking of clicks on per-item **external** article links (third-party domains PostHog can't see).
- No `utm_medium` / `utm_campaign` tagging — `utm_source` alone; per-digest covered by `$pathname`.
- No new PostHog account/project setup, consent/cookie-banner work, or changes to what PostHog already captures.
- No tagging of the unsubscribe link (`/api/unsubscribe`) — it's an API redirect, not an engagement page.
