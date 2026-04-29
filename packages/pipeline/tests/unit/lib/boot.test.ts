import { describe, expect, it, vi, afterEach } from "vitest";

// vi.hoisted ensures the spy is initialized before vi.mock runs (which gets hoisted)
const { mockExecutablePath } = vi.hoisted(() => ({
  mockExecutablePath: vi.fn<() => string>(),
}));

vi.mock("playwright", () => ({
  chromium: {
    executablePath: mockExecutablePath,
  },
}));

import { assertChromiumInstalled } from "@pipeline/lib/boot.js";

describe("assertChromiumInstalled", () => {
  afterEach(() => {
    mockExecutablePath.mockReset();
  });

  it("calls process.exit(1) and logs the install command when executablePath throws", () => {
    mockExecutablePath.mockImplementation(() => {
      throw new Error("Executable not found");
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
    expect(errorMessages).toHaveLength(1);
    const msg = errorMessages[0];
    expect(typeof msg).toBe("string");
    expect(msg as string).toContain("pnpm exec playwright install chromium");
  });

  it("returns void and does not log or exit when executablePath succeeds", () => {
    mockExecutablePath.mockReturnValue("/usr/bin/chromium");

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
