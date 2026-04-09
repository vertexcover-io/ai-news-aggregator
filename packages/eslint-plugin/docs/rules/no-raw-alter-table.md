# `newsletter/no-raw-alter-table`

Disallow raw `ALTER TABLE` statements passed to `.execute(...)`. Schema changes must go through Drizzle Kit migrations.

## Rationale

Raw `ALTER TABLE` calls executed at runtime bypass the migration history,
so the database schema diverges from what `drizzle-kit` knows about. The
next `db:generate` then produces a confusing or incorrect diff, and other
developers can no longer reproduce the schema by running migrations.

All schema changes — adding columns, renaming tables, dropping constraints —
must be performed via a generated Drizzle Kit migration:

```bash
pnpm --filter @newsletter/shared db:generate
pnpm --filter @newsletter/shared db:migrate
```

## Examples

### Valid

Non-`ALTER TABLE` SQL is fine:

```ts
db.execute(sql`SELECT 1`);
```

Variable arguments are not inspected (see Limitations):

```ts
const query = "ALTER TABLE foo ADD COLUMN bar";
db.execute(query);
```

A different method is unaffected:

```ts
db.insert(values);
```

### Invalid

String literal containing `ALTER TABLE`:

```ts
db.execute("ALTER TABLE foo ADD COLUMN bar");
// => rawAlterTable
```

Template literal containing `ALTER TABLE` (the regex matches the raw quasi
text, regardless of interpolations):

```ts
db.execute(`ALTER TABLE ${table} RENAME TO baz`);
// => rawAlterTable
```

Case-insensitive — extra whitespace and lowercase still match:

```ts
db.execute("alter   table foo add column bar");
// => rawAlterTable
```

## Limitations

- **No data-flow analysis (EDGE-010).** The rule only inspects the
  syntactic shape of the first argument to `.execute()`. If the SQL string
  is built up in a variable and passed in (`const q = "ALTER TABLE ..."; db.execute(q);`),
  the rule will not flag it. This is intentional — full taint tracking is
  out of scope for a syntactic ESLint rule. If you need stricter
  enforcement, the migration policy must be enforced at code-review time.
- **`.execute()` matched on any object.** The rule fires on any
  `.execute(...)` member call, not just on `db`. In the unlikely case that
  another library exposes an `.execute(string)` method whose argument
  legitimately contains `ALTER TABLE` text (e.g., a SQL parser test
  fixture), disable the rule on that line.

## Scope

Wired in the root `eslint.config.mjs` for:
- `packages/pipeline/src/**/*.ts`
- `packages/api/src/**/*.ts`

## When to disable

Disable per-line (`/* eslint-disable-next-line newsletter/no-raw-alter-table */`)
only when the `ALTER TABLE` text is **not** an actual SQL execution — for
example, a fixture string in a test asserting that the rule itself fires.
Production code should never disable this rule.
