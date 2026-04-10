# Wire shapes live in @newsletter/shared, not only in the API zod schema

When adding a new field to an API request or response body, update the shared TypeScript type in @newsletter/shared in the same change as the zod validator in packages/api/src/lib/validate.ts. The frontend imports the wire shape from @newsletter/shared, so a zod-only change silently leaves the client typed against a stale contract — the API accepts the field, the frontend cannot set it, and the typecheck only fails in whichever package imports the shared type next.

```ts
// BAD: only the zod schema knows about the new field
// packages/api/src/lib/validate.ts
export const runSubmitSchema = z.object({
  hn: hnConfigSchema,
  reddit: redditConfigSchema,
  profileName: z.string().optional(), // added here only
});

// packages/shared/src/types/run.ts  (unchanged -> frontend sees stale type)
export interface RunSubmitPayload {
  hn: HnConfig;
  reddit: RedditConfig;
}

// GOOD: shared type and zod schema move together
export interface RunSubmitPayload {
  hn: HnConfig;
  reddit: RedditConfig;
  profileName?: string;
}
```

Checklist when touching any API body:
1. Update the TS type in @newsletter/shared.
2. Update the zod schema in packages/api/src/lib/validate.ts.
3. Assert the zod output matches the shared type (z.infer assignable to the interface, or satisfies ZodType<RunSubmitPayload>).
4. Grep for consumers of the shared type and verify they compile.

Why: In the personalized-ranking run, phase 8 added profileName to the API zod schema but not to the shared RunSubmitPayload type. Phase 9 (frontend) hit a typecheck failure the moment it tried to pass profileName through the API client. The split-brain between zod and shared types is a recurring class of bug in this monorepo — the shared package is the contract, zod is just runtime validation of that contract.
