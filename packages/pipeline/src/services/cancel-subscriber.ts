import type IORedis from "ioredis";
import { runCancelChannel } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("service:cancel-subscriber");

export interface CancelSubscription {
  close(): Promise<void>;
}

export interface CancelSubscriberFactory {
  subscribe(runId: string, onCancel: () => void): Promise<CancelSubscription>;
}

export function createCancelSubscriber(
  connection: IORedis,
): CancelSubscriberFactory {
  return {
    async subscribe(runId, onCancel) {
      // Duplicate connection so pub/sub mode doesn't block other redis commands.
      const sub = connection.duplicate();

      sub.on("error", (err: Error) => {
        logger.warn({ runId, error: err.message }, "cancel subscriber error — run will complete normally");
      });

      await sub.subscribe(runCancelChannel(runId));

      sub.on("message", (channel: string) => {
        if (channel === runCancelChannel(runId)) {
          onCancel();
        }
      });

      return {
        async close() {
          try {
            await sub.unsubscribe(runCancelChannel(runId));
            sub.disconnect();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ runId, error: msg }, "cancel subscriber close error");
          }
        },
      };
    },
  };
}
