import IORedis, { type RedisOptions } from "ioredis";

export function createRedisConnection(opts?: RedisOptions): IORedis {
  const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    ...opts,
  });
}
