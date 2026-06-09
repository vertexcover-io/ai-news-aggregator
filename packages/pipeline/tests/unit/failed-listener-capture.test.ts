import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

// We need to test handleWorkerFailure without importing the real index.ts (which boots workers)
// So we test it from the module it will be extracted to.
// We import the helper function directly.

const mockCaptureException = vi.fn<(error: unknown, context?: Record<string, unknown>) => void>();

import { handleWorkerFailure } from "@pipeline/lib/worker-failure.js";

describe("pipeline failed listener capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REQ-007: terminal attempt triggers capture
  describe("test_REQ_007_pipeline_failed_terminal_captures", () => {
    it("calls captureException when job.attemptsMade >= opts.attempts", () => {
      const job = {
        id: "job-123",
        name: "run-process",
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as unknown as Job;

      handleWorkerFailure("processing", job, new Error("fatal"), mockCaptureException);

      expect(mockCaptureException).toHaveBeenCalledOnce();
      expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
        queue: "processing",
        jobId: "job-123",
        jobName: "run-process",
      });
    });

    it("calls captureException with context for collection queue", () => {
      const job = {
        id: "col-456",
        name: "collect-hn",
        attemptsMade: 1,
        opts: { attempts: 1 },
      } as unknown as Job;

      handleWorkerFailure("collection", job, new Error("collect fail"), mockCaptureException);

      expect(mockCaptureException).toHaveBeenCalledOnce();
      expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
        queue: "collection",
        jobId: "col-456",
        jobName: "collect-hn",
      });
    });

    it("treats attempts=undefined as 1 (terminal on first failure)", () => {
      const job = {
        id: "job-no-attempts",
        name: "daily-run",
        attemptsMade: 1,
        opts: {},  // no attempts field
      } as unknown as Job;

      handleWorkerFailure("processing", job, new Error("first fail"), mockCaptureException);

      expect(mockCaptureException).toHaveBeenCalledOnce();
    });
  });

  // REQ-008: retryable job NOT captured; EDGE-003 covered here too
  describe("test_REQ_008_pipeline_failed_retryable_skips", () => {
    it("does not call captureException when attemptsMade < opts.attempts", () => {
      const job = {
        id: "job-retry",
        name: "run-process",
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job;

      handleWorkerFailure("processing", job, new Error("retryable"), mockCaptureException);

      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("does not call captureException when job is undefined", () => {
      handleWorkerFailure("collection", undefined, new Error("no job"), mockCaptureException);

      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });

  // EDGE-003: retryable job not captured (same behavior, explicit test)
  describe("test_EDGE_003_retryable_job_not_captured", () => {
    it("skips capture for a job with 2 of 5 attempts exhausted", () => {
      const job = {
        id: "job-early-fail",
        name: "email-send",
        attemptsMade: 2,
        opts: { attempts: 5 },
      } as unknown as Job;

      handleWorkerFailure("processing", job, new Error("transient"), mockCaptureException);

      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });
});
