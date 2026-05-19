# Library Probe — admin-pipeline-cost-analysis

> **Run at:** 2026-05-19
> **Verdict:** PASS

## Summary

| Dependency | Health | Smoke | Final |
|---|---|---|---|
| Anthropic model `claude-haiku-4-5-20251001` | trusted | VERIFIED (live `GET /v1/models`) | VERIFIED |
| Anthropic model `claude-sonnet-4-6` | trusted | VERIFIED (live `GET /v1/models`) | VERIFIED |
| Anthropic pricing rates | trusted | VERIFIED (fetched from docs.anthropic.com) | VERIFIED |
| Vercel AI SDK `generateObject` usage shape (`ai` 5.0.169 + `@ai-sdk/anthropic` 2.0.74) | trusted | VERIFIED (live probe against Anthropic) | VERIFIED |
| Drizzle JSONB nullable column pattern (`drizzle-orm` 0.42.0) | trusted | VERIFIED (matches 7+ existing usages in schema.ts) | VERIFIED |

## Installed versions
- `ai`: 5.0.169
- `@ai-sdk/anthropic`: 2.0.74
- `drizzle-orm`: 0.42.0

---

## Probe 1 — Anthropic model IDs exist

Live call to `GET https://api.anthropic.com/v1/models?limit=50`:

```
claude-opus-4-7              | Claude Opus 4.7    | 2026-04-14
claude-sonnet-4-6            | Claude Sonnet 4.6  | 2026-02-17
claude-opus-4-6              | Claude Opus 4.6    | 2026-02-04
claude-opus-4-5-20251101     | Claude Opus 4.5    | 2025-11-24
claude-haiku-4-5-20251001    | Claude Haiku 4.5   | 2025-10-15
claude-sonnet-4-5-20250929   | Claude Sonnet 4.5  | 2025-09-29
claude-opus-4-1-20250805     | Claude Opus 4.1    | 2025-08-05
claude-opus-4-20250514       | Claude Opus 4      | 2025-05-22
claude-sonnet-4-20250514     | Claude Sonnet 4    | 2025-05-22
```

Both ids referenced by code defaults exist:
- `claude-haiku-4-5-20251001` ✓
- `claude-sonnet-4-6` ✓

Note on the CLAUDE.md vs code mismatch flagged in the design: pipeline CLAUDE.md says rank defaults to haiku, but `packages/pipeline/src/processors/rank.ts:21` defines `DEFAULT_MODEL = "claude-sonnet-4-6"`. **Both ids are valid** at Anthropic so this is not a probe failure; it's a documentation/code consistency issue separate from this feature. Out of scope for this probe.

---

## Probe 2 — Anthropic pricing (verified from docs.anthropic.com/en/docs/about-claude/pricing)

Anthropic's pricing table columns: `Model | Base Input | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes (read) | Output`. All rates per million tokens (MTok).

| Model id | Input | 5m write | 1h write | Cache read | Output |
|---|---:|---:|---:|---:|---:|
| `claude-haiku-4-5-20251001` | $1.00 | $1.25 | $2.00 | $0.10 | $5.00 |
| `claude-sonnet-4-6` | $3.00 | $3.75 | $6.00 | $0.30 | $15.00 |

Sanity check against Anthropic's documented multipliers (5m = 1.25× input, 1h = 2× input, read = 0.1× input):
- Haiku: $1.25 = 1.25 × $1 ✓, $2 = 2 × $1 ✓, $0.10 = 0.10 × $1 ✓
- Sonnet: $3.75 = 1.25 × $3 ✓, $6 = 2 × $3 ✓, $0.30 = 0.10 × $3 ✓

### Extended thinking / reasoning tokens

Per the [Extended Thinking docs](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking):

> The original thinking tokens that Claude generated internally are **billed as output tokens**.

There is **no separate "reasoning" line item** on the Anthropic pricing table. Thinking tokens (when extended thinking is enabled) are billed at the standard **output** rate. The design should drop `reasoningPerMTok` as a separate price field and instead price reasoning tokens using `outputPerMTok`.

**Effect on design:** `ModelPricing.reasoningPerMTok` can be removed; cost computation for reasoning tokens uses `outputPerMTok`. This is a minor structural simplification, not a re-plan.

---

## Probe 3 — Vercel AI SDK usage shape (live)

Live `generateObject` call against `anthropic("claude-haiku-4-5-20251001")` with installed SDK versions. Full probe log: `probes/usage-shape.live.log`. Probe script: `probes/usage-shape.mjs`.

### `result.usage` (top-level, SDK-normalized)

```json
{
  "inputTokens": 699,
  "outputTokens": 24,
  "totalTokens": 723,
  "cachedInputTokens": 0
}
```

**Confirmed fields, types, and semantics:**

| Field | Type | Meaning |
|---|---|---|
| `inputTokens` | number | Total input tokens billed at base rate (excludes cache read/write costs). |
| `outputTokens` | number | Total output tokens (includes any extended-thinking tokens). |
| `totalTokens` | number | Sum convenience; do NOT use for pricing. |
| `cachedInputTokens` | number | Cache **read** tokens (cache hits). NOT cache writes. |
| `reasoningTokens` | number \| undefined | **Absent on this call.** SDK only includes this when extended thinking is enabled in the request. Default to 0 when missing. |

### `result.providerMetadata.anthropic`

```json
{
  "usage": {
    "input_tokens": 699,
    "output_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 0
    },
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "cacheCreationInputTokens": 0,
  "stopSequence": null,
  "iterations": null,
  "container": null,
  "contextManagement": null
}
```

**Key fields for cost computation:**

| Path | Type | Meaning |
|---|---|---|
| `cacheCreationInputTokens` | number | **Total cache writes** (sum of 5m + 1h). Lifted to the top of `providerMetadata.anthropic` by the SDK. |
| `usage.cache_creation.ephemeral_5m_input_tokens` | number | 5-minute cache write count (priced at 1.25× base input). |
| `usage.cache_creation.ephemeral_1h_input_tokens` | number | 1-hour cache write count (priced at 2× base input). |
| `usage.cache_read_input_tokens` | number | Cache read count (matches top-level `cachedInputTokens`). |
| `usage.input_tokens`, `usage.output_tokens` | number | Raw Anthropic API counts. Match SDK-normalized values. |

**Implication for `extractAnthropicUsage`:** the helper should read:
- `inputTokens` ← `usage.inputTokens`
- `outputTokens` ← `usage.outputTokens`
- `cachedInputTokens` ← `usage.cachedInputTokens` (with `providerMetadata.anthropic.usage.cache_read_input_tokens` as a cross-check fallback)
- `cacheCreationTokens5m` ← `providerMetadata.anthropic.usage.cache_creation.ephemeral_5m_input_tokens ?? 0`
- `cacheCreationTokens1h` ← `providerMetadata.anthropic.usage.cache_creation.ephemeral_1h_input_tokens ?? 0`
- `reasoningTokens` ← `usage.reasoningTokens ?? 0` (only present when extended thinking enabled)

**Effect on design:** the design used a single `cacheCreationTokens` field. We now know the SDK splits 5m vs 1h, so the design's "if SDK exposes 5m/1h split" branch is satisfied — track them as **two fields** in `StageCost` / `ModelStageCost` so cost is priced exactly:

```ts
cacheCreation5mTokens: number;
cacheCreation1hTokens: number;
```

(Replaces the single `cacheCreationTokens`. Minor type change, design is otherwise intact.)

---

## Probe 4 — Drizzle JSONB nullable column

Pattern `jsonb("cost_breakdown").$type<RunCostBreakdown | null>()` matches 7+ existing usages in `packages/shared/src/db/schema.ts`:

| Line | Usage |
|---|---|
| 51 | `sourceTypes: jsonb("source_types").$type<SourceType[]>()` |
| 56 | `sourceTelemetry: jsonb("source_telemetry").$type<RunSourceTelemetry \| null>()` |
| 62 | `notificationState: jsonb("notification_state").$type<NotificationState \| null>()` |
| 63 | `socialMetadata: jsonb("social_metadata").$type<SocialMetadata \| null>()` |
| 71 | `metadata: jsonb("metadata").$type<SocialTokenMetadata \| null>()` |
| 88 | `hnConfig: jsonb("hn_config").$type<RunSubmitHnConfig \| null>()` |

No issue.

---

## Re-plan deltas (small, non-blocking)

These are minor structural adjustments — design proceeds, but spec-generation should fold these in:

1. **Drop `reasoningPerMTok` from `ModelPricing`.** Thinking tokens are billed at the output rate per Anthropic. Cost formula uses `outputPerMTok` for reasoning tokens.
2. **Split `cacheCreationTokens` into `cacheCreation5mTokens` and `cacheCreation1hTokens`** in `StageCost` and `ModelStageCost`. The SDK exposes both via `providerMetadata.anthropic.usage.cache_creation.ephemeral_{5m,1h}_input_tokens`, so we can price them accurately at 1.25× and 2× input respectively.
3. **`reasoningTokens` is absent (not zero) when extended thinking is disabled.** `extractAnthropicUsage` must default to 0 when the field is missing, not assume it's present.

These are all additive/simplifying clarifications, not a blocking re-plan.

---

## Verified MODEL_PRICING values (to transcribe during implementation)

```ts
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadPerMTok: 0.1,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2.0,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6.0,
  },
};
```

---

## Verification stubs for spec-generation

`docs/spec/admin-pipeline-cost-analysis/probes/verification-stubs.md` (see file) — single VS-0 entry that re-runs `usage-shape.ts` during functional-verify to catch SDK drift.

<!-- LP:VERDICT:PASS -->
