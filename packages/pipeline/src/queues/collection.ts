import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/db";

export const collectionQueue = new Queue("collection", {
  connection: createRedisConnection(),
});
