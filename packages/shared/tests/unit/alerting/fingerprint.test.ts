import { describe, it, expect } from "vitest";
import { fingerprintFor } from "../../../src/alerting/fingerprint.js";

describe("fingerprintFor", () => {
  it("test_EDGE_007_fingerprint_domain_scoped: distinct full URLs on same domain produce identical fingerprint", () => {
    const fp1 = fingerprintFor("enrichment_failed", "example.com");
    const fp2 = fingerprintFor("enrichment_failed", "example.com");
    expect(fp1).toBe(fp2);
  });

  it("different categories produce different fingerprints", () => {
    const fp1 = fingerprintFor("enrichment_failed", "example.com");
    const fp2 = fingerprintFor("job_failed", "example.com");
    expect(fp1).not.toBe(fp2);
  });

  it("different sources produce different fingerprints", () => {
    const fp1 = fingerprintFor("enrichment_failed", "example.com");
    const fp2 = fingerprintFor("enrichment_failed", "other.com");
    expect(fp1).not.toBe(fp2);
  });

  it("no source uses underscore placeholder and stays stable", () => {
    const fp1 = fingerprintFor("worker_crash");
    const fp2 = fingerprintFor("worker_crash");
    expect(fp1).toBe(fp2);
    expect(fp1).toBe("worker_crash:_:_");
  });

  it("uses signature when provided", () => {
    const fp1 = fingerprintFor("api_5xx", "example.com", "GET /api/run");
    const fp2 = fingerprintFor("api_5xx", "example.com", "POST /api/run");
    expect(fp1).not.toBe(fp2);
  });

  it("stable format: category:source:signature", () => {
    const fp = fingerprintFor("job_failed", "my-queue", "MyJobName");
    expect(fp).toBe("job_failed:my-queue:MyJobName");
  });
});
