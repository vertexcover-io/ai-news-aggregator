# Optional chaining on a typed cast result triggers no-unnecessary-condition

After narrowing or casting a value to a non-nullable type (via `as SomeType`, a type guard, or a definite assignment), using `?.` to access its properties triggers the `@typescript-eslint/no-unnecessary-condition` lint rule. TypeScript knows the value cannot be nullish at that point, so the optional chain is both logically wrong and a lint error.

```ts
// BAD: json is cast to VoyageResponse (non-nullable), so ?. is flagged
const json = (await response.json()) as VoyageResponse;
const embeddings = json?.data; // lint error: unnecessary optional chain

// GOOD: use regular property access after a typed cast
const json = (await response.json()) as VoyageResponse;
const embeddings = json.data;
```

This also applies after type guard narrowing:

```ts
if (!isVoyageResponse(json)) throw new Error("...");
const embeddings = json?.data; // still flagged — narrowed to non-nullable above
const embeddings = json.data;  // correct
```

The mistake is common because defensive `?.` feels "safe", but after a cast or guard the safety is already established and the optional chain adds noise that the linter correctly rejects.

**Why:** In the tech-debt cleanup run, `json?.data` after `as VoyageResponse` triggered `@typescript-eslint/no-unnecessary-condition`. Switching to `json.data` fixed the lint error and made the intent explicit.

**How to apply:** After any `as Type`, `satisfies Type`, or type-narrowing guard, use plain property access (`obj.prop`), not optional chaining (`obj?.prop`). Reserve `?.` for values whose nullability has not yet been ruled out.
