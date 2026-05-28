# Library Probe — run-telemetry-live-logs

<!-- LP:VERDICT:PASS -->

**Status:** NOT_APPLICABLE — no external dependencies are introduced or modified by this change.

The work is entirely internal: it routes existing Pino emissions through the existing in-repo `RunLogger` service (`packages/pipeline/src/services/run-logger.ts`), changes a source-identifier derivation to use the existing `deriveRawItemIdentifier` helper, and adds new `run_logs` rows on existing failure paths. No new packages, no new APIs from existing packages, no SDK upgrades.
