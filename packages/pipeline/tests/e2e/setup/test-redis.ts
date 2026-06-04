import IORedis from "ioredis";

let testRedis: IORedis | undefined;

export function getTestRedis(): IORedis {
  if (!testRedis) {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    testRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return testRedis;
}


export async function closeTestRedis(): Promise<void> {
  if (testRedis) {
    await testRedis.quit();
    testRedis = undefined;
  }
}
