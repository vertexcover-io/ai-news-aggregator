/**
 * Unit tests for reconcileAlertDeliverySchedule.
 *
 * The alert-delivery scheduler must be registered UNCONDITIONALLY at startup
 * (D-110 — alerting must keep sweeping even when the daily schedule is off).
 */
import { describe, it, expect, vi } from "vitest";
import {
  reconcileAlertDeliverySchedule,
} from "@api/services/scheduler.js";
import { ALERT_DELIVERY_SCHEDULER_KEY } from "@newsletter/shared/scheduling";

function makeQueue() {
  return {
    upsertJobScheduler: vi.fn(() => Promise.resolve({ id: "sched" })),
    removeJobScheduler: vi.fn(() => Promise.resolve(true)),
  };
}

describe("reconcileAlertDeliverySchedule", () => {
  it("registers the alert-delivery scheduler unconditionally (schedule enabled)", async () => {
    const queue = makeQueue();
    await reconcileAlertDeliverySchedule(queue);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      ALERT_DELIVERY_SCHEDULER_KEY,
      expect.objectContaining({ every: expect.any(Number) }),
      expect.objectContaining({ name: "alert-delivery" }),
    );
  });

  it("registers the alert-delivery scheduler unconditionally (schedule disabled)", async () => {
    // Even if we had a scheduleEnabled=false setting, alerting must keep sweeping
    const queue = makeQueue();
    await reconcileAlertDeliverySchedule(queue);
    // Still called — alerting is always on
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
