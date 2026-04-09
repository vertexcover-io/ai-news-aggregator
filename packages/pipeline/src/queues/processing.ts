import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/redis";

export const PROCESSING_QUEUE_NAME = "processing";

export const processingQueue = new Queue(PROCESSING_QUEUE_NAME, {
  connection: createRedisConnection(),
});
