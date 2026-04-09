import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/redis";

export const collectionQueue = new Queue("collection", {
  connection: createRedisConnection(),
});
