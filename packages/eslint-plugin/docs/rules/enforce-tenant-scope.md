# enforce-tenant-scope

Queries against tenant-owned tables in repository files must include a tenant scope filter or use the `withAllTenants()` escape hatch.

## Rule Details

This rule applies ONLY within `**/repositories/**` files. It flags queries (`.from()`, `.insert()`, `.update()`, `.delete()`) against tenant-owned tables that don't have a detectable tenant-scoping guard.

**Tenant-owned tables:** `rawItems`, `runArchives`, `runLogs`, `socialTokens`, `socialCredentials`, `userSettings`, `mustReadEntries`, `subscribers`, `emailSends`, `feedbackEvents`, `sesEvents`, `evalRuns`, `reviewEdits`.

**Exempt tables:** `users` (login-by-email lookups), `tenants` (super-admin queries).

## Examples

### Incorrect

```typescript
// Repository file — no tenant scope
db.select().from(subscribers).where(eq(subscribers.id, "x"));
db.insert(rawItems).values({ title: "x" });
```

### Correct

```typescript
// Repository with tenant scope parameter
db.select().from(subscribers)
  .where(and(
    eq(subscribers.id, "x"),
    ...(!isAllTenants(scoped) ? [eq(subscribers.tenantId, scoped.ctx.tenantId)] : []),
  ));
```
