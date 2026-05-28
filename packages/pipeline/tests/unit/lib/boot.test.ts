import { describe, expect, it, vi, afterEach } from "vitest";

const { mockAccessSync } = vi.hoisted(() => ({
  mockAccessSync: vi.fn<(path: string, mode?: number) => void>(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    accessSync: mockAccessSync,
  };
});

import { assertChromiumInstalled } from "@pipeline/lib/boot.js";

describe("assertChromiumInstalled", () => {
  afterEach(() => {
    mockAccessSync.mockReset();
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  });

  it("exits when PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is unset", () => {
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

    const errorMessages: unknown[] = [];
    const savedError = console.error;
    console.error = (...args: unknown[]) => errorMessages.push(args[0]);

    const exitCodes: (string | number | null | undefined)[] = [];
    const savedExit = process.exit.bind(process);
    process.exit = (code?: number | string | null) => {
      exitCodes.push(code);
      throw new Error("process.exit called");
    };

    try {
      expect(() => assertChromiumInstalled()).toThrow("process.exit called");
    } finally {
      console.error = savedError;
      process.exit = savedExit;
    }

    expect(exitCodes).toEqual([1]);
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0] as string).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
  });

  it("exits when the binary is not executable", () => {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium";
    mockAccessSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const errorMessages: unknown[] = [];
    const savedError = console.error;
    console.error = (...args: unknown[]) => errorMessages.push(args[0]);

    const exitCodes: (string | number | null | undefined)[] = [];
    const savedExit = process.exit.bind(process);
    process.exit = (code?: number | string | null) => {
      exitCodes.push(code);
      throw new Error("process.exit called");
    };

    try {
      expect(() => assertChromiumInstalled()).toThrow("process.exit called");
    } finally {
      console.error = savedError;
      process.exit = savedExit;
    }

    expect(exitCodes).toEqual([1]);
    expect(errorMessages[0] as string).toContain("/usr/bin/chromium");
  });

  it("returns void when the binary is executable", () => {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium";
    mockAccessSync.mockReturnValue(undefined);

    const errorMessages: unknown[] = [];
    const savedError = console.error;
    console.error = (...args: unknown[]) => errorMessages.push(args[0]);

    const exitCodes: (string | number | null | undefined)[] = [];
    const savedExit = process.exit.bind(process);
    process.exit = (code?: number | string | null) => {
      exitCodes.push(code);
      throw new Error("process.exit called");
    };

    try {
      expect(() => assertChromiumInstalled()).not.toThrow();
    } finally {
      console.error = savedError;
      process.exit = savedExit;
    }

    expect(errorMessages).toHaveLength(0);
    expect(exitCodes).toHaveLength(0);
  });
});
