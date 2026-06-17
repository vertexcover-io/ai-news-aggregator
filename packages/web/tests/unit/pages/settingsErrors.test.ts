import { describe, it, expect } from "vitest";
import type { FieldErrors } from "react-hook-form";
import { firstFieldErrorMessage } from "../../../src/pages/settingsErrors";

// The Settings save error toast must surface the FIRST real field-level
// message, even when the failing field is nested (e.g. twitterConfig.listIds[0]
// .value) — otherwise it falls back to a useless "Please check your inputs."
describe("firstFieldErrorMessage", () => {
  it("returns a top-level field's message", () => {
    const errors = {
      emailTime: { message: "must differ from pipelineTime" },
    } as unknown as FieldErrors;
    expect(firstFieldErrorMessage(errors)).toBe("must differ from pipelineTime");
  });

  it("finds a message nested under an array field (twitterConfig.listIds[0].value)", () => {
    const errors = {
      twitterConfig: {
        listIds: [
          { value: { message: "Twitter list must be a numeric ID" } },
        ],
      },
    } as unknown as FieldErrors;
    expect(firstFieldErrorMessage(errors)).toBe("Twitter list must be a numeric ID");
  });

  it("returns undefined when there is no message anywhere", () => {
    expect(firstFieldErrorMessage({} as FieldErrors)).toBeUndefined();
  });
});
