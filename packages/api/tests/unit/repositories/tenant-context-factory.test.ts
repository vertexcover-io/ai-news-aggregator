/**
 * REQ-126 (NF7): tenant context is plumbed through the repository-factory
 * seam — `createXRepo(db, ctx)` — not ad-hoc per query. With a ctx the
 * emitted WHERE clause carries the `tenant_id` predicate; without one the
 * factory stays in legacy single-tenant mode (backward compat, pre-P5/P9
 * call sites).
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { createSubscribersRepo } from "@api/repositories/subscribers.js";
import { createRunLogRepo } from "@api/repositories/run-logs.js";

const CTX: TenantContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "tenant_admin",
};

const SOME_UUID = "33333333-3333-4333-8333-333333333333";

interface Captured {
  wheres: SQL[];
}

function makeCaptureDb(): { db: AppDb; captured: Captured } {
  const captured: Captured = { wheres: [] };
  const chain: Record<string, unknown> = {};
  const self = (): Record<string, unknown> => chain;
  chain.from = self;
  chain.limit = self;
  chain.orderBy = self;
  chain.groupBy = self;
  chain.leftJoin = self;
  chain.innerJoin = self;
  chain.set = self;
  chain.values = self;
  chain.returning = self;
  chain.where = (cond: SQL): Record<string, unknown> => {
    captured.wheres.push(cond);
    return chain;
  };
  chain.then = (resolve: (rows: never[]) => unknown): unknown => resolve([]);
  const db = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
  } as unknown as AppDb;
  return { db, captured };
}

function renderLastWhere(captured: Captured): { sql: string; params: unknown[] } {
  const last = captured.wheres.at(-1);
  if (last === undefined) throw new Error("no where clause captured");
  const query = new PgDialect().sqlToQuery(last);
  return { sql: query.sql, params: [...query.params] };
}

describe("test_REQ_126_repo_factory_requires_tenant_context", () => {
  it("createMustReadRepo(db, ctx).findById emits a tenant_id predicate", async () => {
    const { db, captured } = makeCaptureDb();
    const repo = createMustReadRepo(db, CTX);
    await repo.findById(SOME_UUID);
    const { sql, params } = renderLastWhere(captured);
    expect(sql).toContain("tenant_id");
    expect(params).toContain(CTX.tenantId);
  });

  it("createSubscribersRepo(db, ctx).findByEmail emits a tenant_id predicate", async () => {
    const { db, captured } = makeCaptureDb();
    const repo = createSubscribersRepo(db, CTX);
    await repo.findByEmail("someone@example.com");
    const { sql, params } = renderLastWhere(captured);
    expect(sql).toContain("tenant_id");
    expect(params).toContain(CTX.tenantId);
  });

  it("createRunLogRepo(db, ctx).listForRun emits a tenant_id predicate", async () => {
    const { db, captured } = makeCaptureDb();
    const repo = createRunLogRepo(db, CTX);
    await repo.listForRun(SOME_UUID);
    const { sql, params } = renderLastWhere(captured);
    expect(sql).toContain("tenant_id");
    expect(params).toContain(CTX.tenantId);
  });

  it("omitting ctx keeps legacy single-tenant behavior (no tenant_id predicate)", async () => {
    const { db, captured } = makeCaptureDb();
    const repo = createMustReadRepo(db);
    await repo.findById(SOME_UUID);
    const { sql, params } = renderLastWhere(captured);
    expect(sql).not.toContain("tenant_id");
    expect(params).not.toContain(CTX.tenantId);
  });
});
