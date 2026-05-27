import { describe, it, expect } from "vitest";
import { buildPublishFailedMessage } from "@shared/slack/builders/publish-failed.js";

const RUN_ID = "1172e372-e5f4-4a84-b65f-43c28ddf3948";

function sectionText(blocks: readonly unknown[]): string {
  const section = blocks.find(
    (b) => (b as { type: string }).type === "section",
  ) as { text: { text: string } } | undefined;
  return section?.text.text ?? "";
}

describe("buildPublishFailedMessage — reason-specific copy", () => {
  it("header carries the channel label", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { text: { text: string } } | undefined;
    expect(header?.text.text).toBe("LinkedIn was not posted");
  });

  it("not_reviewed → original 'not reviewed in time' wording (preserved)", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
      reason: "not_reviewed",
    });
    expect(sectionText(blocks)).toContain("not reviewed in time");
  });

  it("refresh_unavailable → mentions expired token + reconnect (the prod bug)", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
      reason: "refresh_unavailable",
    });
    const text = sectionText(blocks);
    expect(text).toContain("token expired");
    expect(text).toContain("reconnect");
    expect(text).not.toContain("not reviewed in time");
  });

  it("no_token → mentions no credentials configured", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
      reason: "no_token",
    });
    expect(sectionText(blocks)).toContain("no credentials are configured");
  });

  it("http_401 → mentions the platform rejected the request with the code", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
      reason: "http_401",
    });
    const text = sectionText(blocks);
    expect(text).toContain("HTTP 401");
    expect(text).toContain("rejected");
  });

  it("unknown reason → generic but correct fallback (never the misleading review copy)", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "twitter-post",
      reason: "some_new_reason",
    });
    const text = sectionText(blocks);
    expect(text).toContain("some_new_reason");
    expect(text).not.toContain("not reviewed in time");
  });

  it("no reason → generic fallback, no review-timing claim", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: RUN_ID,
      channel: "linkedin-post",
    });
    const text = sectionText(blocks);
    expect(text).toContain("could not be completed");
    expect(text).not.toContain("not reviewed in time");
  });
});
