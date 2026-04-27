# Use `importOriginal` when partially mocking a shared barrel module

When `vi.mock("@newsletter/shared", ...)` replaces the whole module, every named export not explicitly listed in the mock factory becomes `undefined`. For barrel modules (`@newsletter/shared`, `@newsletter/api/lib`, etc.) that re-export many utilities, this silently breaks any code under test that uses those re-exports — the failures appear as `undefined is not a function` on seemingly unrelated symbols.

Always use `importOriginal` to spread the real module before overriding specific exports:

```ts
// BAD: breaks every re-export not explicitly listed
vi.mock("@newsletter/shared", () => ({
  getDb: vi.fn().mockReturnValue(mockDb),
}));

// GOOD: real module is preserved; only getDb is overridden
vi.mock("@newsletter/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@newsletter/shared")>();
  return { ...real, getDb: vi.fn().mockReturnValue(mockDb) };
});
```

Why: In the tech-debt coverage run, mocking `@newsletter/shared` without `importOriginal` caused `runKey` (also exported from shared) to be `undefined` inside the module under test, producing confusing failures unrelated to the mock target.

Enforced by: manual review when writing `vi.mock` for barrel/shared modules
