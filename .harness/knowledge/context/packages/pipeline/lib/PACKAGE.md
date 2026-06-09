---
governs: packages/pipeline/src/lib/
last_verified_sha: f7d27361d5e1390adf9561d55d413e75457b584c
key_files: [boot.ts, cancelled-error.ts, abortable-fetch.ts, delay.ts, email-provider.ts, email-render.ts, email-send-common.ts]
flow_fns: [email-render.ts::renderNewsletter, email-provider.ts::createEmailProvider]
decisions: [D-140, D-121]
status: active
---

# lib/ — low-level utilities and provider wrappers

## Purpose
Small, focused utility modules: process boot validation, abort-signal-aware fetch wrappers, cancellable delays, email provider abstraction (Resend + SES), and the React-based newsletter HTML renderer.

## Public surface
- `assertChromiumInstalled()` → `void` — validates `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` points to an executable binary; exits process on failure
- `CancelledError` class — typed error carrying `runId` for distinguishing cancel from failure
- `withAbortSignal(baseFetch, runSignal)` → `typeof fetch` — merges a run-level AbortSignal with per-request signals
- `delay(ms, signal?)` → `Promise<void>` — cancellable delay (rejects on signal abort)
- `createEmailProvider()` → `EmailProvider` — returns Resend or SES provider based on `EMAIL_PROVIDER` env
- `renderNewsletter(props)` → `Promise<string>` — renders React email component to HTML string via `@react-email/components`
- `email-send-common.ts` (shared by `email-send.ts` + deprecated `newsletter-send.ts`, extracted in refactor #250):
  - `createSendPacer(rate, deps?)` → `SendPacer` — module-level token-bucket pacer (`acquire()` serializes ops at `rate`/s; the email-send worker holds ONE singleton across all jobs)
  - `classifyDeliveryFailure(message)` → `string` — maps raw provider error → concise label (rate limit / recipient rejected / …) for the Slack top-3 summary
  - `chunk(arr, size)` → `T[][]`, `htmlToPlainText(html)`, `formatArchiveDate(date)`, `issueUnsubToken(subscriberId, secret)` — send-loop helpers

## Depends on / used by
- Uses: `@aws-sdk/client-sesv2`, `resend`, `@react-email/components`, `@newsletter/shared`
- Used by: `workers/email-send.ts`, `workers/newsletter-send.ts`, `src/index.ts`

## Data flows

### renderNewsletter(props) → string
  props { stories, issueDate, unsubscribeUrl, baseUrl, archiveUrl, digestHeadline, digestSummary, ... }
    → React.createElement(NewsletterEmail) → render() from @react-email/components
      → HTML string with inline styles + <style> mobile breakpoints
  (stories rendered as StoryBlock components: title link, optional image, summary lede, bullets, BOTTOM LINE pull-quote)
  (archive ribbon inserted after story N; closer CTA + footer with unsubscribe link at bottom)
  (archiveUrl is passed pre-tagged with utm_source=email by the caller; footer home link is tagged via withUtmSource(baseUrl, "email") inside the renderer — D-121)

### createEmailProvider() → EmailProvider
  process.env.EMAIL_PROVIDER:
    ├─ "ses" → SESv2Client (AWS SDK) → send: SendEmailCommand
    └─ else → Resend client → send: client.emails.send
      ├─ result.error → throw EmailSendError with retryable classification
      └─ ok → { messageId }

## Gotchas / landmines
- **Resend provider throws typed `EmailSendError`**: The wrapper classifies errors by `result.error.name` against `RETRYABLE_RESEND_CODES`. The `retryAfterMs` is parsed from the `retry-after` response header (delta-seconds or HTTP-date). The caller (email-send worker) uses these fields for retry decisions. (D-140)
- **`assertChromiumInstalled` exits the process**: Called at startup before accepting any jobs. A missing Chromium binary is a fatal startup error, not a per-job failure.
- **Email render is React SSR**: Uses `@react-email/components` which renders React to static HTML. No client-side JS in the output. Mobile responsiveness via `@media` queries in a `<style>` tag (Gmail/Apple Mail/Outlook iOS all honor media queries in `<head>`).
- **`SendPacer` is a per-process singleton, not per-job**: The email-send worker constructs ONE `createSendPacer(EMAIL_SEND_RATE_PER_SECOND)` at module load and shares it across every `email-send` job invocation — a second back-to-back job does NOT reset the token bucket. This is the sole rate guard (NOT BullMQ `concurrency:1`, which would serialize all job types). See root D-001 + `.claude/rules/learnings/queue-concurrency-vs-in-process-pacer.md`.

## Decisions
- **D-140**: `EmailSendError` as typed error with `retryable` and `retryAfterMs`. Why: the email-send retry loop needs structured signal from the provider (retryable vs non-retryable, when to retry). Throwing a typed error is simpler than a result union at the provider boundary. Tradeoff: the error is thrown synchronously from `send()` — callers must catch and inspect. Governs: `lib/email-provider.ts`, `@newsletter/shared/types`.
