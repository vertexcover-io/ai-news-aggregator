import { describe, expect, it, vi } from "vitest";
import { createRedisThrottle } from "@shared/services/redis-throttle.js";

function makeRedis(delays: number[]) {
  const calls: (string | number)[][] = [];
  let i = 0;
  return {
    calls,
    eval: vi.fn((script: string, numKeys: number, ...args: (string | number)[]) => {
      calls.push([script, numKeys, ...args]);
      return Promise.resolve(delays[i++] ?? 0);
    }),
  };
}

describe("createRedisThrottle (REQ-068)", () => {
  it("reserves a slot under the shared key and waits the returned delay", async () => {
    const redis = makeRedis([0, 50]);
    const sleep = vi.fn(() => Promise.resolve());
    const throttle = createRedisThrottle({
      redis,
      key: "throttle:twitter-collector",
      ratePerSecond: 20,
      now: () => 1_000,
      sleep,
    });

    await throttle.acquire();
    expect(sleep).not.toHaveBeenCalled();

    await throttle.acquire();
    expect(sleep).toHaveBeenCalledWith(50);

    // key, now, interval (ceil(1000/20)=50ms), ttl margin
    const [, numKeys, key, now, interval, ttlMargin] = redis.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe("throttle:twitter-collector");
    expect(now).toBe(1_000);
    expect(interval).toBe(50);
    // Margin added to the reserved backlog inside the script — the script
    // computes PX as (reservedSlot - now) + margin so the key outlives waiters.
    expect(ttlMargin).toBe(60_000);
  });

  it("is a no-op when ratePerSecond <= 0 (disabled)", async () => {
    const redis = makeRedis([]);
    const sleep = vi.fn(() => Promise.resolve());
    const throttle = createRedisThrottle({
      redis,
      key: "throttle:twitter-collector",
      ratePerSecond: 0,
      sleep,
    });

    await throttle.acquire();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
