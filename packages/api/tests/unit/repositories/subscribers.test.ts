import { describe, it, expect } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberSelect, SubscriberStatus } from "@newsletter/shared";
import { createSubscribersRepo } from "@api/repositories/subscribers.js";

function makeRow(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test@example.com",
    status: "pending" as SubscriberStatus,
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: null,
    unsubscribedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Creates a minimal fake DB that simulates the conditional UPDATE used by updateStatus.
 * The UPDATE only returns a row when the new status differs from the stored status
 * (mimicking WHERE id = $id AND status <> $newStatus).
 */
function makeFakeDb(initial: SubscriberSelect | null): {
  db: Pick<AppDb, "select" | "update">;
  store: { row: SubscriberSelect | null };
} {
  const store: { row: SubscriberSelect | null } = { row: initial ? { ...initial } : null };

  const db = {
    update: () => ({
      set: (patch: Partial<SubscriberSelect>) => ({
        where: () => ({
          returning: () => {
            if (store.row === null) {
              return Promise.resolve([]);
            }
            const newStatus: SubscriberStatus | undefined = patch.status;
            if (newStatus !== undefined && store.row.status === newStatus) {
              // Condition ne(status, newStatus) fails — no-op
              return Promise.resolve([]);
            }
            store.row = { ...store.row, ...patch };
            return Promise.resolve([store.row]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (store.row === null) return Promise.resolve([]);
            return Promise.resolve([store.row]);
          },
        }),
      }),
    }),
  } as unknown as Pick<AppDb, "select" | "update">;

  return { db, store };
}

describe("createSubscribersRepo.updateStatus", () => {
  it("returns {changed:true, next:'confirmed'} when row was pending", async () => {
    const { db } = makeFakeDb(makeRow({ status: "pending" }));
    const repo = createSubscribersRepo(db, "00000000-0000-0000-0000-000000000000");

    const result = await repo.updateStatus("00000000-0000-0000-0000-000000000001", "confirmed", {
      subscribedAt: new Date("2026-01-02T00:00:00Z"),
      confirmToken: null,
      confirmTokenExpiresAt: null,
    });

    expect(result.changed).toBe(true);
    expect(result.next).toBe("confirmed");
    expect(result.row.status).toBe("confirmed");
    expect(result.row.subscribedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("returns {changed:false, next:'confirmed'} on second call with same status", async () => {
    const { db } = makeFakeDb(makeRow({ status: "confirmed" }));
    const repo = createSubscribersRepo(db, "00000000-0000-0000-0000-000000000000");

    const result = await repo.updateStatus("00000000-0000-0000-0000-000000000001", "confirmed");

    expect(result.changed).toBe(false);
    expect(result.next).toBe("confirmed");
    expect(result.row.status).toBe("confirmed");
  });

  it("throws when id does not exist (update branch — no row returned and select empty)", async () => {
    const { db } = makeFakeDb(null);
    const repo = createSubscribersRepo(db, "00000000-0000-0000-0000-000000000000");

    await expect(
      repo.updateStatus("00000000-0000-0000-0000-000000000099", "confirmed"),
    ).rejects.toThrow("subscriber 00000000-0000-0000-0000-000000000099 not found");
  });

  it("preserves extra fields on the changed branch (subscribedAt, unsubscribedAt, confirmToken nullables)", async () => {
    const subscribedAt = new Date("2026-03-15T10:00:00Z");
    const { db } = makeFakeDb(makeRow({ status: "pending", confirmToken: "tok", confirmTokenExpiresAt: new Date() }));
    const repo = createSubscribersRepo(db, "00000000-0000-0000-0000-000000000000");

    const result = await repo.updateStatus("00000000-0000-0000-0000-000000000001", "confirmed", {
      subscribedAt,
      confirmToken: null,
      confirmTokenExpiresAt: null,
    });

    expect(result.changed).toBe(true);
    expect(result.row.subscribedAt).toEqual(subscribedAt);
    expect(result.row.confirmToken).toBeNull();
    expect(result.row.confirmTokenExpiresAt).toBeNull();
  });

  it("extra fields are NOT applied on the no-op branch", async () => {
    const originalSubscribedAt = new Date("2026-01-01T00:00:00Z");
    const { db } = makeFakeDb(makeRow({ status: "confirmed", subscribedAt: originalSubscribedAt }));
    const repo = createSubscribersRepo(db, "00000000-0000-0000-0000-000000000000");

    const result = await repo.updateStatus("00000000-0000-0000-0000-000000000001", "confirmed", {
      subscribedAt: new Date("2026-06-01T00:00:00Z"),
    });

    expect(result.changed).toBe(false);
    // The store was not mutated — row still has the original subscribedAt
    expect(result.row.subscribedAt).toEqual(originalSubscribedAt);
  });
});
