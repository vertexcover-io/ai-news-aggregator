import { describe, it, expect } from "vitest";
import type { EvalRunInsertInput } from "@newsletter/shared/types/eval-ranking";
import { createEvalRunsRepo } from "@api/repositories/eval-runs.js";

interface StoredRow {
  id: string;
  mode: "scored" | "ab";
  fixtureId: string | null;
  date: string | null;
  windowSize: number | null;
  draftPromptHash: string;
  draftPromptSnapshot: string;
  savedPromptHash: string | null;
  savedPromptSnapshot: string | null;
  status: "running" | "done" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  scoreBreakdown: unknown;
  costBreakdown: unknown;
  errorMessage: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pred = (row: StoredRow) => boolean;

interface FakeDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  rows: StoredRow[];
  pushPred: (p: Pred) => void;
}

function makeFakeDb(): FakeDb {
  const rows: StoredRow[] = [];
  const predStack: Pred[] = [];
  let idCounter = 0;

  function genUuid(): string {
    idCounter += 1;
    const hex = idCounter.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }

  function shiftPred(): Pred {
    const p = predStack.shift();
    if (!p) throw new Error("no predicate queued");
    return p;
  }

  const insertBuilder = (): {
    values: (v: Partial<StoredRow>) => {
      returning: () => Promise<{ id: string }[]>;
    };
  } => ({
    values(v) {
      const row: StoredRow = {
        id: genUuid(),
        mode: v.mode ?? "scored",
        fixtureId: v.fixtureId ?? null,
        date: v.date ?? null,
        windowSize: v.windowSize ?? null,
        draftPromptHash: v.draftPromptHash ?? "",
        draftPromptSnapshot: v.draftPromptSnapshot ?? "",
        savedPromptHash: v.savedPromptHash ?? null,
        savedPromptSnapshot: v.savedPromptSnapshot ?? null,
        status: v.status ?? "running",
        startedAt: v.startedAt ?? new Date(Date.now() + idCounter), // unique sort key
        finishedAt: v.finishedAt ?? null,
        scoreBreakdown: v.scoreBreakdown ?? null,
        costBreakdown: v.costBreakdown ?? null,
        errorMessage: v.errorMessage ?? null,
      };
      rows.push(row);
      return {
        returning: () => Promise.resolve([{ id: row.id }]),
      };
    },
  });

  const updateBuilder = (): {
    set: (patch: Partial<StoredRow>) => {
      where: () => { returning: () => Promise<{ id: string }[]> };
    };
  } => ({
    set(patch) {
      return {
        where() {
          const pred = shiftPred();
          const matching = rows.filter(pred);
          for (const r of matching) Object.assign(r, patch);
          return {
            returning: () => Promise.resolve(matching.map((r) => ({ id: r.id }))),
          };
        },
      };
    },
  });

  interface SelectChain extends PromiseLike<unknown> {
    from: () => SelectChain;
    $dynamic: () => SelectChain;
    where: () => SelectChain;
    orderBy: () => SelectChain;
    limit: (n: number) => SelectChain;
    offset: (n: number) => SelectChain;
  }

  function makeSelectChain(isCount: boolean): SelectChain {
    const state: { where?: Pred; limit?: number; offset?: number } = {};

    function execute(): StoredRow[] | { count: number }[] {
      let working = [...rows];
      if (state.where) working = working.filter(state.where);
      working.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      if (isCount) return [{ count: working.length }];
      const off = state.offset ?? 0;
      const lim = state.limit ?? working.length;
      return working.slice(off, off + lim);
    }

    const chain: SelectChain = {
      from: () => chain,
      $dynamic: () => chain,
      where: () => {
        state.where = shiftPred();
        return chain;
      },
      orderBy: () => chain,
      limit: (n: number) => {
        state.limit = n;
        return chain;
      },
      offset: (n: number) => {
        state.offset = n;
        return chain;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(execute()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const db = {
    insert: () => insertBuilder(),
    update: () => updateBuilder(),
    select: (cols?: unknown) => {
      const isCount = cols !== undefined && typeof cols === "object";
      return makeSelectChain(isCount);
    },
  };

  return { db, rows, pushPred: (p) => predStack.push(p) };
}

function baseInput(over: Partial<EvalRunInsertInput> = {}): EvalRunInsertInput {
  return {
    mode: "scored",
    fixtureId: "fx-1",
    date: null,
    windowSize: 10,
    draftPromptHash: "abc123def456",
    draftPromptSnapshot: "draft prompt",
    savedPromptHash: null,
    savedPromptSnapshot: null,
    ...over,
  };
}

const byId =
  (id: string): Pred =>
  (r) =>
    r.id === id;

describe("eval-runs repository", () => {
  it("INSERT then getById returns the row with status='running'", async () => {
    const fake = makeFakeDb();
    const repo = createEvalRunsRepo(fake.db, "00000000-0000-4000-8000-00000000aaaa");
    const { id } = await repo.insert(baseInput());
    expect(UUID_RE.test(id)).toBe(true);

    fake.pushPred(byId(id));
    const row = await repo.getById(id);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(id);
    expect(row?.status).toBe("running");
    expect(row?.mode).toBe("scored");
    expect(row?.draftPromptHash).toBe("abc123def456");
    expect(row?.fixtureId).toBe("fx-1");
    expect(typeof row?.startedAt).toBe("string"); // ISO
  });

  it("updateFinish on existing id: rowsAffected=1, getById shows status='done' + breakdowns", async () => {
    const fake = makeFakeDb();
    const repo = createEvalRunsRepo(fake.db, "00000000-0000-4000-8000-00000000aaaa");
    const { id } = await repo.insert(baseInput());

    fake.pushPred(byId(id));
    const result = await repo.updateFinish(id, {
      scoreBreakdown: { meanNdcg: 0.7 },
      costBreakdown: { usd: 0.5 },
    });
    expect(result.rowsAffected).toBe(1);

    fake.pushPred(byId(id));
    const row = await repo.getById(id);
    expect(row?.status).toBe("done");
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.scoreBreakdown).toEqual({ meanNdcg: 0.7 });
    expect(row?.costBreakdown).toEqual({ usd: 0.5 });
  });

  it("updateFailed on existing id: rowsAffected=1, status='failed', errorMessage truncated to 512", async () => {
    const fake = makeFakeDb();
    const repo = createEvalRunsRepo(fake.db, "00000000-0000-4000-8000-00000000aaaa");
    const { id } = await repo.insert(baseInput());

    const longMsg = "x".repeat(600);
    fake.pushPred(byId(id));
    const result = await repo.updateFailed(id, { errorMessage: longMsg });
    expect(result.rowsAffected).toBe(1);

    fake.pushPred(byId(id));
    const row = await repo.getById(id);
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage?.length).toBe(512);
    expect(row?.errorMessage).toBe("x".repeat(512));
  });

  it("updateFinish on a fake uuid: rowsAffected=0 (silent no-op detected)", async () => {
    const fake = makeFakeDb();
    const repo = createEvalRunsRepo(fake.db, "00000000-0000-4000-8000-00000000aaaa");
    const ghostId = "11111111-2222-4333-8444-555555555555";

    fake.pushPred(byId(ghostId));
    const result = await repo.updateFinish(ghostId, {
      scoreBreakdown: {},
      costBreakdown: {},
    });
    expect(result.rowsAffected).toBe(0);
  });

  it("list with no filters paginates correctly (3 rows, page=1 perPage=2 -> 2, total=3)", async () => {
    const fake = makeFakeDb();
    const repo = createEvalRunsRepo(fake.db, "00000000-0000-4000-8000-00000000aaaa");
    await repo.insert(baseInput({ fixtureId: "a" }));
    await repo.insert(baseInput({ fixtureId: "b" }));
    await repo.insert(baseInput({ fixtureId: "c" }));

    // Every list query now carries the tenant predicate (REQ-126).
    fake.pushPred(() => true);
    fake.pushPred(() => true);
    const result = await repo.list({ page: 1, perPage: 2 });
    expect(result.runs.length).toBe(2);
    expect(result.total).toBe(3);
    // EvalRunSummary should not carry snapshots
    const sample = result.runs[0];
    expect(sample && "draftPromptSnapshot" in sample).toBe(false);
  });

  // The list-filter cases (mode/status/fixtureId/AND-compose) were tautological:
  // the WHERE predicate was supplied by the test via fake.pushPred(...), so they
  // asserted the test's own predicate rather than the repo's generated SQL.
  // Real filter behavior is exercised against Postgres in the eval e2e suite.
});
