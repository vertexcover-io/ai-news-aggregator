import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Rettiwt, User } from "rettiwt-api";
import {
  resolveTwitterHandles,
  TwitterHandleResolutionError,
} from "@api/services/twitter-handle-resolver.js";

interface UserDetailsStub {
  details: ReturnType<typeof vi.fn>;
}

function makeRettiwt(detailsImpl: (handle: string) => Promise<User | undefined> | User | undefined): {
  rettiwt: Pick<Rettiwt, "user">;
  stub: UserDetailsStub;
} {
  const stub: UserDetailsStub = {
    details: vi.fn((handle: string) => Promise.resolve(detailsImpl(handle))),
  };
  return {
    rettiwt: { user: stub } as unknown as Pick<Rettiwt, "user">,
    stub,
  };
}

function userOf(id: string, userName: string): User {
  return {
    id,
    userName,
    fullName: userName,
    createdAt: "2009-01-01T00:00:00.000Z",
    followersCount: 0,
    followingsCount: 0,
    isVerified: false,
    likeCount: 0,
    pinnedTweets: [],
    profileImage: "",
    statusesCount: 0,
  } as User;
}

const ORIGINAL_KEY = process.env.RETTIWT_API_KEY;

describe("resolveTwitterHandles", () => {
  beforeEach(() => {
    process.env.RETTIWT_API_KEY = "test-key";
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.RETTIWT_API_KEY;
    else process.env.RETTIWT_API_KEY = ORIGINAL_KEY;
  });

  it("returns empty array when no handles given (no factory call)", async () => {
    const factory = vi.fn();
    const out = await resolveTwitterHandles([], { rettiwtFactory: factory as never });
    expect(out).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it("REQ-045: resolves a handle to userId", async () => {
    const { rettiwt, stub } = makeRettiwt(() => userOf("12", "jack"));
    const out = await resolveTwitterHandles(["jack"], {
      rettiwtFactory: () => rettiwt as Rettiwt,
    });
    expect(out).toEqual([{ handle: "jack", userId: "12" }]);
    expect(stub.details).toHaveBeenCalledWith("jack");
  });

  it("strips leading @ from handle before calling rettiwt", async () => {
    const { rettiwt, stub } = makeRettiwt(() => userOf("99", "elonmusk"));
    const out = await resolveTwitterHandles(["@elonmusk"], {
      rettiwtFactory: () => rettiwt as Rettiwt,
    });
    expect(stub.details).toHaveBeenCalledWith("elonmusk");
    expect(out).toEqual([{ handle: "elonmusk", userId: "99" }]);
  });

  it("REQ-046: throws not_found when details() returns undefined", async () => {
    const { rettiwt } = makeRettiwt(() => undefined);
    await expect(
      resolveTwitterHandles(["nobody"], { rettiwtFactory: () => rettiwt as Rettiwt }),
    ).rejects.toMatchObject({
      name: "TwitterHandleResolutionError",
      handle: "nobody",
      reason: "not_found",
    });
  });

  it("REQ-046: throws not_found when details() returns user without id", async () => {
    const { rettiwt } = makeRettiwt(() => ({ id: "", userName: "x" }) as User);
    await expect(
      resolveTwitterHandles(["x"], { rettiwtFactory: () => rettiwt as Rettiwt }),
    ).rejects.toMatchObject({ reason: "not_found", handle: "x" });
  });

  it("throws auth_failed when rettiwt throws 'Not authorized to access requested resource'", async () => {
    const { rettiwt } = makeRettiwt(() => {
      throw new Error("Not authorized to access requested resource");
    });
    await expect(
      resolveTwitterHandles(["jack"], { rettiwtFactory: () => rettiwt as Rettiwt }),
    ).rejects.toMatchObject({ reason: "auth_failed", handle: "jack" });
  });

  it("throws unknown for any other thrown error", async () => {
    const { rettiwt } = makeRettiwt(() => {
      throw new Error("network down");
    });
    await expect(
      resolveTwitterHandles(["jack"], { rettiwtFactory: () => rettiwt as Rettiwt }),
    ).rejects.toMatchObject({ reason: "unknown", handle: "jack" });
  });

  it.each<{ name: string; apply: () => void }>([
    {
      name: "env is unset",
      apply: () => {
        delete process.env.RETTIWT_API_KEY;
      },
    },
    {
      name: "env is empty string",
      apply: () => {
        process.env.RETTIWT_API_KEY = "";
      },
    },
  ])(
    "REQ-047: throws missing_api_key without calling factory when $name",
    async ({ apply }) => {
      apply();
      const factory = vi.fn();
      await expect(
        resolveTwitterHandles(["jack"], { rettiwtFactory: factory as never }),
      ).rejects.toMatchObject({ reason: "missing_api_key" });
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("TwitterHandleResolutionError carries cause when provided", () => {
    const cause = new Error("orig");
    const e = new TwitterHandleResolutionError("h", "unknown", cause);
    expect(e.handle).toBe("h");
    expect(e.reason).toBe("unknown");
    expect((e as { cause?: unknown }).cause).toBe(cause);
  });
});
