# Drizzle query builder mocks must chain to exactly the right depth

Drizzle's query builder is a chainable builder: each method call returns a new builder object, not a promise. A mock that terminates one level too early returns an object instead of a promise — the test hangs or receives the wrong type, with no error pointing at the mock depth.

Count the exact chain depth from the real query and match it in the mock:

```ts
// findBySourceAndExternalId — 4-level chain: .select().from().where().limit()
const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),  // resolves here
      }),
    }),
  }),
};

// findExistingExternalIds — 3-level chain: .select().from().where()  (no .limit())
const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),    // resolves here — one level shallower
    }),
  }),
};
```

Getting the depth wrong by even one level produces a silent wrong-type result, not an error. Always read the actual repository function to count its chain before writing the mock.

Why: In the tech-debt coverage run, `findBySourceAndExternalId` (4 levels) and `findExistingExternalIds` (3 levels) needed different mock depths. Using the wrong depth caused silent hangs or wrong return types.

Enforced by: manual review when mocking Drizzle query builders in tests
