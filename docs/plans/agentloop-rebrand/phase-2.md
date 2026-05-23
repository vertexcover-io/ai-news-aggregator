# Phase 2: Schema + migration + repository

> **Status:** pending

## Overview

Add the `must_read_entries` table to the shared schema, generate migration `0027`, and create the API-side repository factory with the CRUD methods Phase 3 and Phase 4 will call.

## Implementation

**Files:**

- Modify: `packages/shared/src/db/schema.ts` — add `mustReadEntries` table definition + `MustReadEntry`, `MustReadEntryInsert` type exports
- Generate: `packages/shared/migrations/0027_<name>.sql` via `pnpm --filter @newsletter/shared db:generate`
- Create: `packages/api/src/repositories/must-read.ts`
  - Export: `createMustReadRepo(db: AppDb): MustReadRepo`
  - Methods: `listPublic()`, `listAdmin()`, `findById(id)`, `findByUrl(url)`, `findRandom()`, `create(input)`, `update(id, patch)`, `delete(id)`, `count()`
- Create: `packages/api/src/repositories/__tests__/must-read.test.ts` — repo unit tests using a test DB

**Tests:**

- `findRandom()` over a seeded set of 3 entries called 30 times — each entry returned at least once (uniformity smoke test)
- `findByUrl()` returns null when not present, the row when present (used by duplicate detection)
- `create()` rejects with a typed error on unique-violation
- `update()` does NOT touch `addedAt`; `updatedAt` increases monotonically (REQ-026, EDGE-009)
- `delete()` returns true on success, false when no row removed

**Pattern to follow:** `packages/api/src/repositories/run-archives.ts` — interface declaration, factory function, drizzle query builder usage.

**Traces to:** REQ-023, REQ-024, REQ-026, REQ-027, NF-003, EDGE-009, EDGE-013

**Schema:**

```ts
export const mustReadEntries = pgTable("must_read_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  author: text("author"),
  year: integer("year"),
  annotation: text("annotation").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("must_read_entries_added_at_idx").on(desc(t.addedAt)),
]);

export type MustReadEntry = typeof mustReadEntries.$inferSelect;
export type MustReadEntryInsert = typeof mustReadEntries.$inferInsert;
```

**Repo shape:**

```ts
export interface MustReadRepo {
  listPublic(): Promise<Omit<MustReadEntry, "updatedAt">[]>;
  listAdmin(): Promise<MustReadEntry[]>;
  findById(id: string): Promise<MustReadEntry | null>;
  findByUrl(url: string): Promise<MustReadEntry | null>;
  findRandom(): Promise<MustReadEntry | null>;
  create(input: { url: string; title: string; author: string | null; year: number | null; annotation: string }): Promise<MustReadEntry>;
  update(id: string, patch: Partial<{ url: string; title: string; author: string | null; year: number | null; annotation: string }>): Promise<MustReadEntry | null>;
  delete(id: string): Promise<boolean>;
}
```

`findRandom()` uses `ORDER BY random() LIMIT 1`. `update()` sets `updatedAt = now()` explicitly via Drizzle's `.set({ ...patch, updatedAt: sql\`now()\` })` and never includes `addedAt` in the patch object.

**Commit:** `feat(shared,api): add must_read_entries table + repo`

## Done When

- [ ] Migration `0027_*.sql` generated and committed
- [ ] `pnpm infra:up && pnpm --filter @newsletter/shared db:migrate` applies cleanly
- [ ] Repo unit tests pass (use the existing e2e DB fixture pattern)
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
