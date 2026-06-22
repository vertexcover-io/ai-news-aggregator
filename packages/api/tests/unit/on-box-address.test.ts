/**
 * isOnBoxAddress gates the /internal/tls-allow ask endpoint. Caddy reaches the
 * API over the host loopback publish, but in the containerized deploy that hop
 * traverses Docker's bridge, so the API sees the bridge gateway (RFC-1918), not
 * 127.0.0.1. The helper must treat loopback AND private ranges as on-box while
 * still refusing genuinely public sources.
 */
import { describe, expect, it } from "vitest";
import { isOnBoxAddress } from "@api/app.js";

describe("isOnBoxAddress", () => {
  it.each([
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "172.18.0.1", // Docker default bridge gateway
    "::ffff:172.18.0.1", // IPv4-mapped IPv6 form node reports
    "172.31.255.254", // top of the 172.16/12 range
    "10.0.0.1",
    "192.168.1.1",
  ])("accepts on-box / private peer %s", (addr) => {
    expect(isOnBoxAddress(addr)).toBe(true);
  });

  it.each([
    "8.8.8.8", // public
    "172.15.0.1", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
    "192.169.0.1", // outside 192.168/16
    "203.0.113.7",
    "not-an-ip",
    "",
  ])("refuses public / malformed peer %s", (addr) => {
    expect(isOnBoxAddress(addr)).toBe(false);
  });
});
