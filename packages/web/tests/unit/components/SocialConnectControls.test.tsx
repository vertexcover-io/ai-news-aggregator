/**
 * Unit tests for the shared SocialConnectControls (Fix #2).
 *
 * The control drives the OAuth connect/reconnect/disconnect for both LinkedIn
 * and Twitter, in both Settings and the onboarding wizard. The platform-specific
 * status hook + start function are injected as props so one component serves
 * both platforms (and tests pass fakes directly).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

vi.mock("../../../src/api/socialCredentials", () => ({
  useDeleteSocialCredentials: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { useDeleteSocialCredentials } from "../../../src/api/socialCredentials";
import { SocialConnectControls } from "../../../src/components/SocialConnectControls";
import type { TwitterOAuthStatus } from "../../../src/api/socialCredentials";

const mockUseDelete = useDeleteSocialCredentials as unknown as MockInstance;
const mockToastSuccess = toast.success as unknown as MockInstance;
const mockToastError = toast.error as unknown as MockInstance;

function mutationStub(): ReturnType<typeof useDeleteSocialCredentials> {
  return {
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteSocialCredentials>;
}

function statusResult(
  data: TwitterOAuthStatus | null,
  refetch = vi.fn(),
): UseQueryResult<TwitterOAuthStatus> {
  return {
    data,
    isLoading: false,
    refetch,
  } as unknown as UseQueryResult<TwitterOAuthStatus>;
}

const CONNECTED: TwitterOAuthStatus = {
  clientConfigured: true,
  connected: true,
  connectedAs: "@agentloop",
  expiresAt: "2026-12-31T00:00:00.000Z",
  hasRefreshToken: true,
};
const DISCONNECTED: TwitterOAuthStatus = {
  clientConfigured: true,
  connected: false,
  connectedAs: null,
  expiresAt: null,
  hasRefreshToken: false,
};
const NO_CLIENT: TwitterOAuthStatus = { ...DISCONNECTED, clientConfigured: false };

function renderControls(opts: {
  status: UseQueryResult<TwitterOAuthStatus>;
  start?: (returnTo?: string) => Promise<{ authorizeUrl: string }>;
  returnTo?: string;
  onBeforeConnect?: () => Promise<void>;
  path?: string;
}): void {
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <MemoryRouter initialEntries={[opts.path ?? "/admin/settings"]}>
      {children}
    </MemoryRouter>
  );
  render(
    <SocialConnectControls
      platform="twitter"
      label="Twitter / X"
      returnTo={opts.returnTo ?? "/admin/settings"}
      useStatus={() => opts.status}
      start={opts.start ?? (() => Promise.resolve({ authorizeUrl: "https://x/auth" }))}
      onBeforeConnect={opts.onBeforeConnect}
    />,
    { wrapper: Wrapper as React.ComponentType<{ children: ReactNode }> },
  );
}

import type React from "react";

beforeEach(() => {
  mockUseDelete.mockReturnValue(mutationStub());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SocialConnectControls", () => {
  it("not connected → Connect button enabled, 'Not connected' text", () => {
    renderControls({ status: statusResult(DISCONNECTED) });
    expect(screen.getByTestId("twitter-conn-status").textContent).toContain(
      "Not connected",
    );
    expect(
      screen.getByTestId("twitter-connect-btn").hasAttribute("disabled"),
    ).toBe(false);
  });

  it("clientConfigured false → Connect disabled + super-admin hint", () => {
    renderControls({ status: statusResult(NO_CLIENT) });
    expect(
      screen.getByTestId("twitter-connect-btn").hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByTestId("twitter-connection").textContent).toContain(
      "super admin",
    );
  });

  it("connected → connectedAs + expiry + refresh ✓; Reconnect + Disconnect present", () => {
    renderControls({ status: statusResult(CONNECTED) });
    const status = screen.getByTestId("twitter-conn-status");
    expect(status.textContent).toContain("@agentloop");
    expect(status.textContent).toContain("2026");
    expect(status.textContent).toContain("✓");
    expect(screen.getByTestId("twitter-connect-btn").textContent).toContain("Reconnect");
    expect(screen.getByTestId("twitter-disconnect-btn")).toBeTruthy();
  });

  it("Connect click → onBeforeConnect awaited, then start(returnTo), then redirect", async () => {
    const order: string[] = [];
    const onBeforeConnect = vi.fn(() => {
      order.push("before");
      return Promise.resolve();
    });
    const start = vi.fn((rt?: string) => {
      order.push(`start:${rt ?? ""}`);
      return Promise.resolve({ authorizeUrl: "https://x/auth?ok=1" });
    });
    const assign = vi.fn();
    const assignSpy = vi.spyOn(window, "location", "get").mockReturnValue({
      assign,
    } as unknown as Location);

    renderControls({
      status: statusResult(DISCONNECTED),
      start,
      returnTo: "/admin/onboarding",
      onBeforeConnect,
    });
    fireEvent.click(screen.getByTestId("twitter-connect-btn"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://x/auth?ok=1");
    });
    expect(start).toHaveBeenCalledWith("/admin/onboarding");
    expect(order).toEqual(["before", "start:/admin/onboarding"]);
    assignSpy.mockRestore();
  });

  it("Disconnect click → useDeleteSocialCredentials.mutate('twitter')", () => {
    const mutate = vi.fn();
    mockUseDelete.mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteSocialCredentials>);
    renderControls({ status: statusResult(CONNECTED) });
    fireEvent.click(screen.getByTestId("twitter-disconnect-btn"));
    expect(mutate).toHaveBeenCalled();
    expect(mutate.mock.calls[0]?.[0]).toBe("twitter");
  });

  it("?twitter=connected on mount → success toast + refetch", async () => {
    const refetch = vi.fn();
    renderControls({
      status: statusResult(CONNECTED, refetch),
      path: "/admin/settings?twitter=connected",
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("?twitter=error on mount → error toast", async () => {
    renderControls({
      status: statusResult(DISCONNECTED),
      path: "/admin/settings?twitter=error&reason=exchange",
    });
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });
});
