import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type {
  NormalizedTweet,
  TwitterClient,
  TwitterClientFetchOptions,
  TwitterClientFetchResult,
  TwitterCollectorDeps,
} from "@pipeline/collectors/twitter/types.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

interface LogEntry {
  level: "info" | "warn" | "error" | "debug";
  obj: Record<string, unknown>;
  msg?: string;
}

const logs: LogEntry[] = [];

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: (obj: unknown, msg?: string) => undefined;
    warn: (obj: unknown, msg?: string) => undefined;
    error: (obj: unknown, msg?: string) => undefined;
    debug: (obj: unknown, msg?: string) => undefined;
  } => ({
    info: (obj: unknown, msg?: string): undefined => {
      logs.push({ level: "info", obj: obj as Record<string, unknown>, msg });
      return undefined;
    },
    warn: (obj: unknown, msg?: string): undefined => {
      logs.push({ level: "warn", obj: obj as Record<string, unknown>, msg });
      return undefined;
    },
    error: (obj: unknown, msg?: string): undefined => {
      logs.push({ level: "error", obj: obj as Record<string, unknown>, msg });
      return undefined;
    },
    debug: (): undefined => undefined,
  }),
}));

const { collectTwitter } = await import(
  "@pipeline/collectors/twitter/index.js"
);

type UpsertFn = ReturnType<
  typeof vi.fn<[items: RawItemInsert[]], Promise<void>>
>;

interface MockRepo extends RawItemsRepo {
  upsertItems: UpsertFn;
}

function createMockRepo(): MockRepo {
  return {
    upsertItems: vi
      .fn<[items: RawItemInsert[]], Promise<void>>()
      .mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn().mockResolvedValue(new Set<string>()),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTweet(overrides: Partial<NormalizedTweet> = {}): NormalizedTweet {
  return {
    id: "1",
    authorHandle: "alice",
    fullText: "hello",
    createdAt: "2026-05-01T00:00:00.000Z",
    url: "https://x.com/alice/status/1",
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    photoUrls: [],
    isRetweet: false,
    isQuote: false,
    ...overrides,
  };
}

interface ClientStub extends TwitterClient {
  fetchListTweets: ReturnType<
    typeof vi.fn<
      [listId: string, opts?: TwitterClientFetchOptions],
      Promise<TwitterClientFetchResult>
    >
  >;
  fetchUserTimeline: ReturnType<
    typeof vi.fn<
      [userId: string, opts?: TwitterClientFetchOptions],
      Promise<TwitterClientFetchResult>
    >
  >;
}

function createClientStub(): ClientStub {
  return {
    fetchListTweets: vi.fn(),
    fetchUserTimeline: vi.fn(),
  };
}

const ORIGINAL_KEY = process.env.RETTIWT_API_KEY;

beforeEach(() => {
  logs.length = 0;
  process.env.RETTIWT_API_KEY = "fake-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.RETTIWT_API_KEY;
  } else {
    process.env.RETTIWT_API_KEY = ORIGINAL_KEY;
  }
});

function findEvent(name: string): LogEntry | undefined {
  return logs.find((l) => l.obj.event === name);
}

function findEvents(name: string): LogEntry[] {
  return logs.filter((l) => l.obj.event === name);
}

function makeDeps(
  client: TwitterClient,
  repo: MockRepo,
  overrides: Partial<TwitterCollectorDeps> = {},
): TwitterCollectorDeps {
  return {
    client,
    rawItemsRepo: repo,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

describe("collectTwitter", () => {
  it("REQ-002: iterates listIds in order", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockImplementation((listId: string) =>
      Promise.resolve({
        tweets: [makeTweet({ id: `t-${listId}` })],
        nextCursor: null,
      }),
    );
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1", "L2", "L3"],
      users: [],
    };

    await collectTwitter(makeDeps(client, repo), config);

    const calls = client.fetchListTweets.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["L1", "L2", "L3"]);
    expect(client.fetchUserTimeline).not.toHaveBeenCalled();
  });

  it("REQ-002b: iterates users in order", async () => {
    const client = createClientStub();
    client.fetchUserTimeline.mockImplementation((uid: string) =>
      Promise.resolve({
        tweets: [makeTweet({ id: `u-${uid}` })],
        nextCursor: null,
      }),
    );
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: [],
      users: [
        { handle: "a", userId: "1" },
        { handle: "b", userId: "2" },
      ],
    };

    await collectTwitter(makeDeps(client, repo), config);

    expect(client.fetchUserTimeline.mock.calls.map((c) => c[0])).toEqual([
      "1",
      "2",
    ]);
    expect(client.fetchListTweets).not.toHaveBeenCalled();
  });

  it("REQ-002c: lists then users in mixed config", async () => {
    const order: string[] = [];
    const client = createClientStub();
    client.fetchListTweets.mockImplementation((listId: string) => {
      order.push(`list:${listId}`);
      return Promise.resolve({ tweets: [], nextCursor: null });
    });
    client.fetchUserTimeline.mockImplementation((uid: string) => {
      order.push(`user:${uid}`);
      return Promise.resolve({ tweets: [], nextCursor: null });
    });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1", "L2"],
      users: [
        { handle: "a", userId: "U1" },
        { handle: "b", userId: "U2" },
      ],
    };

    await collectTwitter(makeDeps(client, repo), config);

    expect(order).toEqual(["list:L1", "list:L2", "user:U1", "user:U2"]);
  });

  it("REQ-003: stops paginating at maxTweetsPerSource (across pages)", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeTweet({ id: `${i}` }),
    );
    const page2 = Array.from({ length: 100 }, (_, i) =>
      makeTweet({ id: `${100 + i}` }),
    );
    const client = createClientStub();
    client.fetchListTweets
      .mockResolvedValueOnce({ tweets: page1, nextCursor: "c1" })
      .mockResolvedValueOnce({ tweets: page2, nextCursor: "c2" });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1"],
      users: [],
      maxTweetsPerSource: 120,
    };

    await collectTwitter(makeDeps(client, repo), config);

    expect(client.fetchListTweets).toHaveBeenCalledTimes(2);
    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted.length).toBe(120);
  });

  it("REQ-003b: does not paginate when nextCursor is null", async () => {
    const client = createClientStub();
    client.fetchUserTimeline.mockResolvedValueOnce({
      tweets: [makeTweet({ id: "x" })],
      nextCursor: null,
    });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: [],
      users: [{ handle: "a", userId: "U1" }],
      maxTweetsPerSource: 200,
    };

    await collectTwitter(makeDeps(client, repo), config);

    expect(client.fetchUserTimeline).toHaveBeenCalledTimes(1);
  });

  it("REQ-004: stops paginating at sinceHours cutoff", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    // sinceHours=24 => cutoff is 2026-05-01T00:00
    const page1 = [
      makeTweet({ id: "a", createdAt: "2026-05-01T23:00:00.000Z" }),
      makeTweet({ id: "b", createdAt: "2026-05-01T12:00:00.000Z" }),
      makeTweet({ id: "c", createdAt: "2026-04-30T12:00:00.000Z" }), // before cutoff
      makeTweet({ id: "d", createdAt: "2026-04-30T00:00:00.000Z" }),
    ];
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValueOnce({
      tweets: page1,
      nextCursor: "c1",
    });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1"],
      users: [],
      sinceHours: 24,
    };

    await collectTwitter(
      makeDeps(client, repo, { now: () => now }),
      config,
    );

    expect(client.fetchListTweets).toHaveBeenCalledTimes(1);
    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted.map((u) => u.externalId)).toEqual(["a", "b"]);
  });

  it("REQ-014, EDGE-006, EDGE-008: dedups by externalId before upsert", async () => {
    const client = createClientStub();
    client.fetchListTweets
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "1" }), makeTweet({ id: "2" })],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "2" }), makeTweet({ id: "3" })],
        nextCursor: null,
      });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1", "L2"],
      users: [],
    };

    const result = await collectTwitter(makeDeps(client, repo), config);

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted.map((u) => u.externalId).sort()).toEqual(["1", "2", "3"]);
    expect(result.itemsFetched).toBe(4);
    expect(result.itemsStored).toBe(3);
  });

  it("REQ-015: calls upsertItems exactly once", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({
      tweets: [makeTweet({ id: "1" })],
      nextCursor: null,
    });
    const repo = createMockRepo();

    await collectTwitter(
      makeDeps(client, repo),
      { listIds: ["L1", "L2"], users: [] },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
  });

  it("REQ-016: result fields shape (itemsFetched/commentsFetched=0/itemsStored/durationMs)", async () => {
    let t = 1000;
    const now = (): Date => new Date(t);
    const client = createClientStub();
    client.fetchListTweets.mockImplementation(() => {
      t += 50;
      return Promise.resolve({
        tweets: [makeTweet({ id: "1" })],
        nextCursor: null,
      });
    });
    const repo = createMockRepo();

    const result = await collectTwitter(
      makeDeps(client, repo, { now }),
      { listIds: ["L1"], users: [] },
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(1);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("REQ-017, EDGE-011: aborts mid-list on signal (throws AbortError, no further calls)", async () => {
    const controller = new AbortController();
    const client = createClientStub();
    client.fetchListTweets.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({
        tweets: [makeTweet({ id: "1" })],
        nextCursor: "c1",
      });
    });
    const repo = createMockRepo();

    await expect(
      collectTwitter(
        makeDeps(client, repo, { signal: controller.signal }),
        { listIds: ["L1", "L2"], users: [] },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(client.fetchListTweets).toHaveBeenCalledTimes(1);
  });

  it("REQ-017: when rettiwt throws Error('Aborted') mid-fetch and signal is aborted, propagates signal.reason (Stage-5 VS-5 finding)", async () => {
    // The library's in-flight request rejects with a generic Error when the
    // signal aborts mid-call. The collector must recognise this as a
    // cancellation and propagate signal.reason (a CancelledError set by the
    // worker via controller.abort(reason)) rather than treating it as a
    // per-source failure that gets swallowed.
    class FakeCancelledError extends Error {
      readonly runId: string;
      constructor(runId: string) {
        super(`Run ${runId} was cancelled`);
        this.name = "CancelledError";
        this.runId = runId;
      }
    }
    const controller = new AbortController();
    const cancelReason = new FakeCancelledError("run-xyz");
    const client = createClientStub();
    client.fetchListTweets.mockImplementationOnce(() => {
      controller.abort(cancelReason);
      return Promise.reject(new Error("Aborted"));
    });
    const repo = createMockRepo();

    const promise = collectTwitter(
      makeDeps(client, repo, { signal: controller.signal }),
      { listIds: ["L1"], users: [] },
    );
    await expect(promise).rejects.toBe(cancelReason);
    // The collector must NOT have called upsertItems or proceeded to subsequent sources.
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  it("REQ-050: missing RETTIWT_API_KEY returns zeros, logs, no client calls", async () => {
    process.env.RETTIWT_API_KEY = "";
    const client = createClientStub();
    const repo = createMockRepo();

    const result = await collectTwitter(
      makeDeps(client, repo),
      { listIds: ["L1"], users: [{ handle: "a", userId: "1" }] },
    );

    expect(result).toMatchObject({
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
    });
    expect(client.fetchListTweets).not.toHaveBeenCalled();
    expect(client.fetchUserTimeline).not.toHaveBeenCalled();
    expect(findEvent("collector.twitter.missing_api_key")).toBeDefined();
  });

  it("REQ-051: auth error stops remaining sources and throws", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockRejectedValueOnce(
      new Error("Not authorized to access requested resource"),
    );
    const repo = createMockRepo();

    await expect(
      collectTwitter(
        makeDeps(client, repo),
        {
          listIds: ["L1", "L2"],
          users: [{ handle: "a", userId: "1" }],
        },
      ),
    ).rejects.toThrow(/twitter auth failed/);

    expect(client.fetchListTweets).toHaveBeenCalledTimes(1);
    expect(client.fetchUserTimeline).not.toHaveBeenCalled();
    expect(findEvent("collector.twitter.auth_failed")).toBeDefined();
  });

  it("REQ-052: 404 on one list logs and continues, recorded in failures", async () => {
    const err404: Error & { status?: number } = Object.assign(
      new Error("HTTP 404 not found"),
      { status: 404 },
    );
    const client = createClientStub();
    client.fetchListTweets
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "ok1" })],
        nextCursor: null,
      })
      .mockRejectedValueOnce(err404)
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "ok3" })],
        nextCursor: null,
      });
    const repo = createMockRepo();

    const result = await collectTwitter(
      makeDeps(client, repo),
      { listIds: ["L1", "L2", "L3"], users: [] },
    );

    expect(client.fetchListTweets).toHaveBeenCalledTimes(3);
    expect(result.itemsStored).toBe(2);
    const failedLog = findEvent("collector.twitter.list_failed");
    expect(failedLog).toBeDefined();
    expect(failedLog?.obj.code).toBe("not_found");
  });

  it("REQ-052, EDGE-010: unknown error class recorded as code: 'unknown'", async () => {
    const client = createClientStub();
    client.fetchListTweets
      .mockRejectedValueOnce(new Error("weirdness"))
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "ok" })],
        nextCursor: null,
      });
    const repo = createMockRepo();

    await collectTwitter(
      makeDeps(client, repo),
      { listIds: ["L1", "L2"], users: [] },
    );

    const failedLog = findEvent("collector.twitter.list_failed");
    expect(failedLog?.obj.code).toBe("unknown");
  });

  it("REQ-053: 429 retries 3x with backoff then records failure", async () => {
    const err429: Error & { status?: number } = Object.assign(
      new Error("HTTP 429 rate limit"),
      { status: 429 },
    );
    const client = createClientStub();
    client.fetchListTweets
      .mockRejectedValueOnce(err429)
      .mockRejectedValueOnce(err429)
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce({
        tweets: [makeTweet({ id: "ok" })],
        nextCursor: null,
      });
    const repo = createMockRepo();
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    const result = await collectTwitter(
      makeDeps(client, repo, { sleep }),
      { listIds: ["L1", "L2"], users: [] },
    );

    expect(client.fetchListTweets).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([250, 1000, 4000]);
    expect(result.itemsStored).toBe(1);
    const failedLog = findEvent("collector.twitter.list_failed");
    expect(failedLog?.obj.code).toBe("rate_limit");
  });

  it("REQ-054: all-failed throws aggregated error naming each source", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockRejectedValue(new Error("HTTP 404"));
    client.fetchUserTimeline.mockRejectedValue(new Error("HTTP 404"));
    const repo = createMockRepo();

    await expect(
      collectTwitter(
        makeDeps(client, repo),
        {
          listIds: ["L1", "L2"],
          users: [{ handle: "a", userId: "U1" }],
        },
      ),
    ).rejects.toThrow(/L1.*L2.*U1|L1.*U1.*L2|L2.*L1.*U1/);
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  it("REQ-055: empty config returns zeros, no client calls", async () => {
    const client = createClientStub();
    const repo = createMockRepo();

    const result = await collectTwitter(
      makeDeps(client, repo),
      { listIds: [], users: [] },
    );

    expect(result).toMatchObject({
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
    });
    expect(client.fetchListTweets).not.toHaveBeenCalled();
    expect(client.fetchUserTimeline).not.toHaveBeenCalled();
    expect(findEvent("collector.twitter.no_lists_configured")).toBeDefined();
  });

  it("REQ-060: start log emitted with listCount and userCount", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({ tweets: [], nextCursor: null });
    client.fetchUserTimeline.mockResolvedValue({ tweets: [], nextCursor: null });
    const repo = createMockRepo();

    await collectTwitter(
      makeDeps(client, repo),
      {
        listIds: ["L1", "L2"],
        users: [{ handle: "a", userId: "1" }],
      },
    );

    const startLog = findEvent("collector.twitter.started");
    expect(startLog).toBeDefined();
    expect(startLog?.obj.listCount).toBe(2);
    expect(startLog?.obj.userCount).toBe(1);
  });

  it("REQ-061: complete log emitted with five fields", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({
      tweets: [makeTweet({ id: "1" })],
      nextCursor: null,
    });
    const repo = createMockRepo();

    await collectTwitter(
      makeDeps(client, repo),
      { listIds: ["L1"], users: [] },
    );

    const completedLog = findEvent("collector.twitter.completed");
    expect(completedLog).toBeDefined();
    expect(completedLog?.obj).toMatchObject({
      event: "collector.twitter.completed",
      itemsFetched: expect.any(Number),
      itemsStored: expect.any(Number),
      failureCount: expect.any(Number),
      durationMs: expect.any(Number),
    });
  });

  it("REQ-062: per-source completion log emitted with kind", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({
      tweets: [makeTweet({ id: "1" })],
      nextCursor: null,
    });
    client.fetchUserTimeline.mockResolvedValue({
      tweets: [makeTweet({ id: "2" })],
      nextCursor: null,
    });
    const repo = createMockRepo();

    await collectTwitter(
      makeDeps(client, repo),
      {
        listIds: ["L1"],
        users: [{ handle: "a", userId: "U1" }],
      },
    );

    const listCompleted = findEvents("collector.twitter.list_completed");
    expect(listCompleted).toHaveLength(1);
    expect(listCompleted[0]?.obj).toMatchObject({
      tweetsFetched: 1,
      pagesFetched: 1,
    });

    const userCompleted = findEvents("collector.twitter.user_completed");
    expect(userCompleted).toHaveLength(1);
    expect(userCompleted[0]?.obj).toMatchObject({
      tweetsFetched: 1,
      pagesFetched: 1,
    });
  });

  // P2 telemetry: per-list and per-user unitResults
  it("P2: unitResults includes lists and users with handle-based display names", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({
      tweets: [makeTweet({ id: "tw-list" })],
      nextCursor: null,
    });
    client.fetchUserTimeline.mockResolvedValue({
      tweets: [makeTweet({ id: "tw-user-1" }), makeTweet({ id: "tw-user-2" })],
      nextCursor: null,
    });
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["1234567890"],
      users: [{ handle: "alice", userId: "U1" }],
    };

    const result = await collectTwitter(makeDeps(client, repo), config);

    expect(result.unitResults).toBeDefined();
    expect(result.unitResults).toHaveLength(2);
    expect(result.unitResults?.[0]).toMatchObject({
      identifier: "list:1234567890",
      displayName: "Twitter list 1234567890",
      itemsFetched: 1,
      status: "completed",
      errors: [],
    });
    expect(result.unitResults?.[1]).toMatchObject({
      identifier: "user:U1",
      displayName: "@alice",
      itemsFetched: 2,
      status: "completed",
      errors: [],
    });
  });

  it("P2: unitResults marks a single user failure as failed while list succeeds", async () => {
    const client = createClientStub();
    client.fetchListTweets.mockResolvedValue({
      tweets: [makeTweet({ id: "list-ok" })],
      nextCursor: null,
    });
    client.fetchUserTimeline.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    const repo = createMockRepo();
    const config: TwitterCollectConfig = {
      listIds: ["L1"],
      users: [{ handle: "ghost", userId: "Uxx" }],
    };

    const result = await collectTwitter(makeDeps(client, repo), config);

    expect(result.unitResults).toHaveLength(2);
    const list = result.unitResults?.find((u) => u.identifier === "list:L1");
    const user = result.unitResults?.find((u) => u.identifier === "user:Uxx");
    expect(list?.status).toBe("completed");
    expect(user?.status).toBe("failed");
    expect(user?.displayName).toBe("@ghost");
    expect(user?.errors.length).toBeGreaterThan(0);
  });

  it("P2: unitResults is [] when RETTIWT_API_KEY missing", async () => {
    delete process.env.RETTIWT_API_KEY;
    const client = createClientStub();
    const repo = createMockRepo();

    const result = await collectTwitter(makeDeps(client, repo), {
      listIds: ["L1"],
      users: [],
    });

    expect(result.unitResults).toEqual([]);
  });

  it("P2: unitResults is [] when no sources configured", async () => {
    const client = createClientStub();
    const repo = createMockRepo();

    const result = await collectTwitter(makeDeps(client, repo), {
      listIds: [],
      users: [],
    });

    expect(result.unitResults).toEqual([]);
  });
});
