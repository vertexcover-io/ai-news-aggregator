# `newsletter/enforce-tenant-scope`

Repository queries touching tenant-owned tables must reference `tenantId`:
compose `eq(table.tenantId, tenantId)` into where clauses and spread
`tenantId` into insert values.

## Rationale

Multi-tenancy isolation (REQ-014) hangs on one seam: every tenant-owned
repository factory takes `tenantId` and every query it builds is scoped to
that tenant. A single forgotten `eq(table.tenantId, tenantId)` silently
leaks one tenant's rows to another. This rule is the static backstop for
that seam — the `tenant-isolation` e2e suite is the behavioral guard, this
rule catches the mistake at lint time.

## How it works (pragmatic heuristic)

The rule fires on `*.select(...)` / `*.insert(...)` / `*.update(...)` /
`*.delete(...)` / `*.execute(...)` / `*.findMany(...)` / `*.findFirst(...)`
call chains inside `repositories/**` files when:

1. the chain's source text references a configured tenant-owned table
   identifier (camelCase Drizzle export or its snake_case SQL name, so raw
   ``sql`...` `` templates are covered best-effort), **and**
2. the nearest *named* enclosing function (the repo method or a named
   helper — anonymous inline callbacks are skipped) does not contain a
   `tenantId` / `tenant_id` **token**. The scan is token-based, never raw
   text, so comments cannot satisfy it — a
   `// tenant_id resolved upstream` comment does not disarm the rule.

Scanning the enclosing method (rather than just the chain) keeps the
idiomatic precomputed-clause pattern valid:

```ts
const where = and(eq(runArchives.tenantId, tenantId), eq(runArchives.reviewed, true));
const rows = await db.select().from(runArchives).where(where);
```

It is a heuristic, not a proof. Documented limitations — all compensated
by the `tenant-isolation` e2e suite, which asserts actual cross-tenant
behavior:

- **Any tenantId token satisfies the scan.** A method containing one
  scoped and one unscoped query on the same table is not flagged; neither
  is a projection-only reference (`.select({ t: rawItems.tenantId })`), an
  `orderBy(table.tenantId)`, or an unused `tenantId` parameter on the
  method. The rule proves *presence* of tenant plumbing, not correct
  composition into the `where` clause.
- **Queries at factory scope auto-pass.** A query whose nearest named
  enclosing function is the factory itself (`createXRepo(db, tenantId)`)
  is satisfied by the factory's `tenantId` parameter token.
- **Table aliases escape matching.** `const t = rawItems; db.delete(t)`
  references no configured table name in the chain text. Do not alias
  table exports in repositories.
- **Variable names can collide with table names.** The chain-text match is
  a word-boundary regex, so an unrelated identifier named `sources`,
  `candidates`, or `subscribers` inside a query on an exempt table (e.g.
  `users`) triggers a false positive. Fix the collision by renaming the
  local variable — never by sprinkling a `tenantId` token into the method
  to silence the rule.

## Options

```jsonc
{
  "newsletter/enforce-tenant-scope": ["error", {
    // Override the default tenant-owned table list (Drizzle export names).
    "tables": ["rawItems", "runArchives", /* ... */],
    // Factory functions allowed to run unscoped queries on tenant tables.
    // Prefer the file-scoped "<file>#<function>" form — a bare function
    // name would exempt any same-named function in any repositories file.
    "allowInFunctions": ["subscribers.ts#createSubscriberTenantLookup"]
  }]
}
```

Default `tables`: `rawItems`, `runArchives`, `runLogs`, `reviewEdits`,
`emailSends`, `subscribers`, `feedbackEvents`, `sesEvents`, `evalRuns`,
`mustReadEntries`, `userSettings`, `socialCredentials`, `socialTokens`,
`candidates`, `evalExports`, `sources`, `sendingDomains`.

Not in the list (genuinely global tables): `users`,
`password_reset_tokens`, `tenants` — queries on those are never flagged.

## Scope

Configured in the root `eslint.config.mjs` to run on:

- `packages/api/src/repositories/**/*.ts`
- `packages/pipeline/src/repositories/**/*.ts`

The rule additionally guards on `/repositories/` in the filename, so it is
inert if a glob ever widens.

## Examples

### Valid

```ts
// scoped select
db.select().from(mustReadEntries).where(eq(mustReadEntries.tenantId, tenantId));

// scoped insert — tenantId spread into values
db.insert(emailSends).values({ ...insert, tenantId });

// scoped update/delete via and()
db.update(mustReadEntries)
  .set(patch)
  .where(and(eq(mustReadEntries.tenantId, tenantId), eq(mustReadEntries.id, id)));

// raw sql filtered on tenant_id
db.execute(sql`select id from run_archives where tenant_id = ${tenantId}`);

// global table — users is not tenant-owned
db.select().from(users).where(eq(users.email, email));
```

### Invalid

```ts
// missing tenant scope in where
db.select().from(rawItems).where(eq(rawItems.id, id));
// => unscopedQuery

// insert without tenantId
db.insert(subscribers).values({ email });
// => unscopedQuery

// unscoped update / delete
db.update(runArchives).set({ reviewed: true }).where(eq(runArchives.id, id));
db.delete(candidates).where(eq(candidates.runId, runId));
// => unscopedQuery

// raw sql touching a tenant table without tenant_id
db.execute(sql`delete from raw_items`);
// => unscopedQuery
```

## Escape hatch: documented global tenancy-resolution lookups

A few flows legitimately query a tenant-owned table without a tenant scope
because the row itself **is** the tenancy resolution: confirm/unsubscribe
links carrying only a signed subscriber token, and SES webhooks carrying
only a `messageId`. These live in dedicated, documented factories and are
exempted via the `allowInFunctions` option in `eslint.config.mjs`:

- `subscribers.ts#createSubscriberTenantLookup` (`packages/api/src/repositories/subscribers.ts`)
- `email-sends.ts#createEmailSendTenantLookup` (`packages/api/src/repositories/email-sends.ts`)

To add a new global lookup: put it in its own `create*TenantLookup` factory
with a doc comment explaining why it resolves tenancy itself, and add a
file-scoped `<file>#<function>` entry to `allowInFunctions`. Do not use
inline `eslint-disable-next-line` for this rule — keeping the exemptions in
one config block keeps the audit surface reviewable.
