import IORedis from "ioredis";
import { Queue } from "bullmq";

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

export async function cleanQueues(queueName = "collection-e2e-test"): Promise<void> {
  const connection = getTestRedis();
  const queue = new Queue(queueName, { connection });
  await queue.obliterate({ force: true });
  await queue.close();
}

export async function closeTestRedis(): Promise<void> {
  if (testRedis) {
    await testRedis.quit();
    testRedis = undefined;
  }
}
