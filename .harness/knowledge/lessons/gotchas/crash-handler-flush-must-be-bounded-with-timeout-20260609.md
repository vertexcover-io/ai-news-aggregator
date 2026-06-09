---
title: "Crash handlers that flush external services must bound the flush with Promise.race + timeout"
date: 2026-06-09
category: gotchas
tags: [crash-handler, process-exit, flush, shutdown, posthog, external-service, uncaughtException, unhandledRejection]
component: pipeline/lib/crash-handlers.ts
severity: high
status: implemented
applies_to: ["packages/api/src/index.ts", "packages/pipeline/src/lib/crash-handlers.ts", "packages/pipeline/src/index.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-09
source: review-fix@posthog-error-tracking
related: []
---

# Crash handlers that flush external services must bound the flush with Promise.race + timeout

## Problem

A crash handler for `uncaughtException` / `unhandledRejection` needs to flush an external
service (PostHog, Slack, a DB connection pool) before calling `process.exit(1)`. If you
`await client.shutdown()` (or `await flush()`) without a timeout, a hung network call
prevents `process.exit` from ever running — the crash handler silently wedges the process
instead of exiting. The code typechecks, tests pass in the happy path, and the bug only
surfaces in production when the PostHog (or other) endpoint is unreachable.

## Insight

**Always wrap any external flush/shutdown inside a crash handler with `Promise.race` and a
hard timeout — never `await` it bare.**

The intent of a crash handler is "best-effort capture + guaranteed exit." An unbounded
`await` subverts the "guaranteed exit" half. The timeout (2 s is a reasonable default)
exists specifically to prevent a network hang from blocking the exit that the operator
expects to see.

This applies to every SDK with a `flush()`/`shutdown()` method used in a crash context:
PostHog, DataDog, Sentry, OpenTelemetry, BullMQ queue close, Postgres pool end, etc.

## Solution

```typescript
// file: packages/pipeline/src/lib/crash-handlers.ts
const SHUTDOWN_TIMEOUT_MS = 2000;

export function createFatalHandler(label: string): (err: unknown) => Promise<void> {
  return async (err: unknown): Promise<void> => {
    logger.fatal({ event: label, error: err instanceof Error ? err.message : String(err) }, label);
    captureException(err, { fatal: true, source: label });
    // Bounded flush — prevents a hung PostHog network call from wedging crash exit.
    await Promise.race([
      shutdownPostHog(),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
    process.exit(1);
  };
}
```

The api side mirrors the same pattern:

```typescript
// file: packages/api/src/index.ts
const onFatal = (label: string) => (err: unknown) => {
  void (async () => {
    await captureException(err, { fatal: true, source: label });
    await Promise.race([
      shutdownAnalytics(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    process.exit(1);
  })();
};
process.on("uncaughtException", onFatal("uncaughtException"));
process.on("unhandledRejection", onFatal("unhandledRejection"));
```

## Prevention / Reuse

- Whenever a spec says "capture + **bounded** flush + exit", the word "bounded" means
  `Promise.race` with a concrete timeout — not just `await flush()`.
- Search new crash handlers for bare `await client.shutdown()` / `await flush()` without
  a `Promise.race` wrapper — that's the smell.
- The timeout value (2 s) is a policy choice balancing "enough time for a fast flush"
  vs "fast enough to not block operator restarts." Document it as a named constant so it
  can be tuned without hunting the magic number.
- This pattern is required in BOTH the api (`src/index.ts`) and pipeline
  (`src/lib/crash-handlers.ts`) crash handler registrations — any new process entrypoint
  that adds crash handlers must follow the same shape.
