import { FlowProducer } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";

let singleton: FlowProducer | null = null;

export function getFlowProducer(): FlowProducer {
  singleton ??= new FlowProducer({ connection: createRedisConnection() });
  return singleton;
}
