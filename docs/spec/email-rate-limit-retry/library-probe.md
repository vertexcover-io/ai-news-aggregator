# Library Probe: email-rate-limit-retry

<!-- LP:VERDICT:PASS -->

## Scope

This feature adds **no new external dependency**. It relies on fields already present on
the `resend` SDK response, which is an existing, in-production dependency. The probe is
therefore a **shape-verification** of the installed `resend` SDK (not a new-library trust
gate). Verified by static inspection of the installed package's `.d.ts` + compiled runtime
(no network call needed — the contract is in the shipped types and code).

## Library: resend

- **Installed version:** `6.12.2` (pnpm store:
  `resend@6.12.2_@react-email+render@2.0.8_react-dom@19.2.4_react@19.2.4__react@19.2.4_`).
- **Maturity:** actively maintained, already powering production email delivery. No bad signals.
- **Auth:** `RESEND_API_KEY` (env). Prod has it set; `EMAIL_PROVIDER` unset → defaults to Resend.
- **Verdict:** VERIFIED.

### Probe 1 — error code shape (retryable classification)

`client.emails.send()` returns `CreateEmailResponse = Response<CreateEmailResponseSuccess>`.
On error, `result.error: ErrorResponse`:

```ts
type ErrorResponse = {
  message: string;
  statusCode: number | null;
  name: RESEND_ERROR_CODE_KEY;   // <-- the error CODE is available
};
```

`RESEND_ERROR_CODE_KEY` enum (verified from `index.d.cts:116`) includes the retryable codes
the design depends on:
`rate_limit_exceeded`, `application_error`, `internal_server_error`
— plus terminal codes we will NOT retry: `validation_error`, `invalid_parameter`,
`invalid_from_address`, `missing_required_field`, `monthly_quota_exceeded`,
`daily_quota_exceeded`, `restricted_api_key`, `invalid_api_key`, etc.

✅ **Confirmed:** retryable-vs-terminal classification can be driven off `result.error.name`,
not just string-matching `message`.

### Probe 2 — retry-after header availability (CORRECTS the design)

The `Response<T>` wrapper type (verified `index.d.cts:117-125`) carries a top-level
`headers: Record<string, string> | null`, and the compiled runtime confirms the SDK
populates it on the error path (`index.mjs:1075-1089`):

```js
const rawError = await response.text();
return {
  data: null,
  error: JSON.parse(rawError),
  headers: Object.fromEntries(response.headers.entries()),  // <-- includes 'retry-after'
};
```

✅ **Confirmed:** `result.headers['retry-after']` IS reachable from the caller — BUT the
current provider wrapper (`packages/pipeline/src/lib/email-provider.ts::createResendProvider`)
only reads `result.error` and `result.data`, **discarding `result.headers`**. To honor
`retry-after`, the wrapper must additionally read `result.headers?.['retry-after']`.

⚠️ **Correction to design:** the design said "current provider discards error.name and
retry-after." Precisely: `error.name` lives on `result.error.name` (present, just unused);
`retry-after` lives on `result.headers['retry-after']` (present at the SDK boundary, just
not destructured). Both are reachable without an SDK upgrade. The typed-error change in the
wrapper must read from **both** `result.error` (name/statusCode/message) and `result.headers`
(retry-after) — the spec/plan must reflect that `retry-after` comes from `result.headers`,
not `result.error`.

### Probe 3 — SES path safety

The SES provider (`@aws-sdk/client-sesv2`) throws AWS SDK errors with no Resend `name`.
The retry classifier must treat a missing/unknown `name` as: retry only on network/timeout
heuristics, otherwise fail fast. Prod is Resend, so SES is a compatibility concern only.
No probe needed beyond confirming the `EmailProvider` interface is unchanged.

## Fallback chain

resend (verified) → existing SES provider → manual operator re-enqueue. No pivot needed.

## Net effect on spec

- Retryable set keyed off `result.error.name ∈ {rate_limit_exceeded, application_error, internal_server_error}` (+ network/timeout heuristics).
- `retry-after` parsed from `result.headers['retry-after']` (seconds or HTTP-date), NOT from `result.error`.
- No SDK upgrade, no new dependency.
