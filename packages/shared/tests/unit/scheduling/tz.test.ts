import { describe, expect, it } from "vitest";
import { dateAtTzTime, publishDateForWindow } from "@shared/scheduling/tz.js";

function localParts(tz: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return formatter.format(date);
}

describe("dateAtTzTime", () => {
  it.each([
    ["UTC", "2026-05-18, 09:30"],
    ["America/New_York", "2026-05-18, 09:30"],
    ["Europe/London", "2026-05-18, 09:30"],
    ["Asia/Kolkata", "2026-05-18, 09:30"],
  ])("round-trips %s wall-clock time", (tz, expected) => {
    const actual = dateAtTzTime(tz, "09:30", new Date("2026-05-18T12:00:00.000Z"));
    expect(localParts(tz, actual)).toBe(expected);
  });

  it("handles US spring-forward DST using the target wall-clock date", () => {
    const actual = dateAtTzTime(
      "America/New_York",
      "09:00",
      new Date("2026-03-08T05:00:00.000Z"),
    );
    expect(actual.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it.each(["9:00", "24:00", "12:60"])("rejects malformed HH:MM value %s", (value) => {
    expect(() => dateAtTzTime("UTC", value)).toThrow("invalid HH:MM time");
  });
});

describe("publishDateForWindow", () => {
  it("schedules an earlier publish time on the next local day", () => {
    const actual = publishDateForWindow({
      timezone: "UTC",
      pipelineTime: "19:00",
      publishTime: "09:00",
      completedAt: new Date("2026-05-18T19:05:00.000Z"),
    });

    expect(actual.toISOString()).toBe("2026-05-19T09:00:00.000Z");
  });

  it("schedules a later publish time on the same local day", () => {
    const actual = publishDateForWindow({
      timezone: "UTC",
      pipelineTime: "07:00",
      publishTime: "09:00",
      completedAt: new Date("2026-05-18T07:05:00.000Z"),
    });

    expect(actual.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  it("rejects equal pipeline and publish times", () => {
    expect(() =>
      publishDateForWindow({
        timezone: "UTC",
        pipelineTime: "19:00",
        publishTime: "19:00",
        completedAt: new Date("2026-05-18T19:05:00.000Z"),
      }),
    ).toThrow("publishTime must differ from pipelineTime");
  });

  it("uses the archive completion date in the schedule timezone", () => {
    const actual = publishDateForWindow({
      timezone: "America/New_York",
      pipelineTime: "19:00",
      publishTime: "09:00",
      completedAt: new Date("2026-05-18T23:05:00.000Z"),
    });

    expect(localParts("America/New_York", actual)).toBe("2026-05-19, 09:00");
  });
});
