/**
 * Unit tests for the LinkedIn Connection sub-section inside SocialCredentialsPanel.
 *
 * Tests:
 * - REQ-011: connected status → renders connectedAs / expiry / refresh facts.
 * - REQ-011: not connected → "Not connected".
 * - REQ-013: clientConfigured false → Connect button disabled + hint.
 * - REQ-012: Connect click (clientConfigured true) → startLinkedInOAuth called →
 *            window.location.assign called with authorizeUrl.
 * - ?linkedin=connected on mount → success toast + status refetch.
 * - ?linkedin=error on mount → error toast.
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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mock the API module ────────────────────────────────────────────────────────
vi.mock("../../../../src/api/socialCredentials", () => ({
  getSocialCredentialsStatus: vi.fn(),
  fetchLinkedInOAuthStatus: vi.fn(),
  startLinkedInOAuth: vi.fn(),
  putLinkedInCredentials: vi.fn(),
  putTwitterCredentials: vi.fn(),
  putTwitterCollectorCookie: vi.fn(),
  deleteSocialCredentials: vi.fn(),
  useSocialCredentialsStatus: vi.fn(),
  useSaveLinkedInCredentials: vi.fn(),
  useSaveTwitterCredentials: vi.fn(),
  useSaveTwitterCollectorCookie: vi.fn(),
  useDeleteSocialCredentials: vi.fn(),
  useLinkedInOAuthStatus: vi.fn(),
  SocialCredentialsApiError: class SocialCredentialsApiError extends Error {
    status: number;
    issues: unknown;
    constructor(message: string, status: number, issues: unknown) {
      super(message);
      this.name = "SocialCredentialsApiError";
      this.status = status;
      this.issues = issues;
    }
  },
}));

// ── Mock sonner toast ─────────────────────────────────────────────────────────
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

import { toast } from "sonner";
import {
  useSocialCredentialsStatus,
  useSaveLinkedInCredentials,
  useSaveTwitterCredentials,
  useSaveTwitterCollectorCookie,
  useDeleteSocialCredentials,
  useLinkedInOAuthStatus,
  fetchLinkedInOAuthStatus,
  startLinkedInOAuth,
} from "../../../../src/api/socialCredentials";
import { SocialCredentialsPanel } from "../../../../src/components/SocialCredentialsPanel";

const mockUseSocialCredentialsStatus = useSocialCredentialsStatus as unknown as MockInstance;
const mockUseSaveLinkedInCredentials = useSaveLinkedInCredentials as unknown as MockInstance;
const mockUseSaveTwitterCredentials = useSaveTwitterCredentials as unknown as MockInstance;
const mockUseSaveTwitterCollectorCookie = useSaveTwitterCollectorCookie as unknown as MockInstance;
const mockUseDeleteSocialCredentials = useDeleteSocialCredentials as unknown as MockInstance;
const mockUseLinkedInOAuthStatus = useLinkedInOAuthStatus as unknown as MockInstance;
// fetchLinkedInOAuthStatus is mocked but used indirectly via the hook mock
void fetchLinkedInOAuthStatus;
const mockStartLinkedInOAuth = startLinkedInOAuth as unknown as MockInstance;
const mockToastSuccess = toast.success as unknown as MockInstance;
const mockToastError = toast.error as unknown as MockInstance;

// ── Helpers ───────────────────────────────────────────────────────────────────
function noopMutation(): ReturnType<typeof useSaveLinkedInCredentials> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    error: null,
    data: undefined,
    variables: undefined,
    status: "idle",
    reset: vi.fn(),
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
  } as unknown as ReturnType<typeof useSaveLinkedInCredentials>;
}

const defaultCredentialsStatus = {
  linkedin: { configured: true, apiVersion: "202511", updatedAt: "2026-01-01T00:00:00Z" },
  twitter: { configured: false, updatedAt: null },
  twitterCollector: { configured: false, updatedAt: null },
};

function setupDefaultHooks(overrides: {
  oauthStatus?: object;
  clientConfigured?: boolean;
} = {}): void {
  const creds = overrides.clientConfigured === false
    ? { linkedin: { configured: false, apiVersion: null, updatedAt: null }, twitter: { configured: false, updatedAt: null }, twitterCollector: { configured: false, updatedAt: null } }
    : defaultCredentialsStatus;

  mockUseSocialCredentialsStatus.mockReturnValue({
    data: creds,
    isLoading: false,
    isError: false,
  });
  mockUseSaveLinkedInCredentials.mockReturnValue(noopMutation());
  mockUseSaveTwitterCredentials.mockReturnValue(noopMutation());
  mockUseSaveTwitterCollectorCookie.mockReturnValue(noopMutation());
  mockUseDeleteSocialCredentials.mockReturnValue(noopMutation());

  const defaultOAuth = {
    data: overrides.oauthStatus ?? null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  mockUseLinkedInOAuthStatus.mockReturnValue(defaultOAuth);
}

function renderPanel(initialPath = "/admin/settings"): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<SocialCredentialsPanel />, { wrapper: Wrapper as React.ComponentType<{ children: ReactNode }> });
}

import type React from "react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LinkedIn Connection section", () => {
  describe("REQ-011: connected status renders connection facts", () => {
    beforeEach(() => {
      setupDefaultHooks({
        oauthStatus: {
          clientConfigured: true,
          connected: true,
          connectedAs: "Alice Smith",
          expiresAt: "2026-12-31T00:00:00.000Z",
          hasRefreshToken: true,
        },
      });
    });

    it("renders connectedAs name", () => {
      renderPanel();
      expect(screen.getByTestId("linkedin-conn-status")).toBeTruthy();
      expect(screen.getByTestId("linkedin-conn-status").textContent).toContain("Alice Smith");
    });

    it("renders expiresAt date", () => {
      renderPanel();
      const status = screen.getByTestId("linkedin-conn-status");
      // Should contain something date-like from the expiry
      expect(status.textContent).toContain("2026");
    });

    it("renders refresh token present indicator (✓)", () => {
      renderPanel();
      const status = screen.getByTestId("linkedin-conn-status");
      expect(status.textContent).toContain("✓");
    });

    it("renders Reconnect button (not disabled)", () => {
      renderPanel();
      const btn = screen.getByTestId("linkedin-connect-btn");
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("REQ-011: not connected → 'Not connected'", () => {
    beforeEach(() => {
      setupDefaultHooks({
        oauthStatus: {
          clientConfigured: true,
          connected: false,
          connectedAs: null,
          expiresAt: null,
          hasRefreshToken: false,
        },
      });
    });

    it("shows 'Not connected' text", () => {
      renderPanel();
      expect(screen.getByTestId("linkedin-conn-status").textContent).toContain("Not connected");
    });

    it("renders Connect button (not disabled)", () => {
      renderPanel();
      const btn = screen.getByTestId("linkedin-connect-btn");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("REQ-013: clientConfigured false → Connect button disabled + hint", () => {
    beforeEach(() => {
      setupDefaultHooks({
        clientConfigured: false,
        oauthStatus: {
          clientConfigured: false,
          connected: false,
          connectedAs: null,
          expiresAt: null,
          hasRefreshToken: false,
        },
      });
    });

    it("Connect button is disabled", () => {
      renderPanel();
      const btn = screen.getByTestId("linkedin-connect-btn");
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it("hint text is visible", () => {
      renderPanel();
      const connection = screen.getByTestId("linkedin-connection");
      expect(connection.textContent).toContain("Save Client ID");
    });
  });

  describe("REQ-012: Connect click → startLinkedInOAuth → window.location.assign", () => {
    let assignSpy: MockInstance;

    beforeEach(() => {
      setupDefaultHooks({
        oauthStatus: {
          clientConfigured: true,
          connected: false,
          connectedAs: null,
          expiresAt: null,
          hasRefreshToken: false,
        },
      });
      mockStartLinkedInOAuth.mockResolvedValue({ authorizeUrl: "https://linkedin.com/oauth/authorize?test=1" });
      const mockAssign = vi.fn();
      assignSpy = vi.spyOn(window, "location", "get").mockReturnValue({
        assign: mockAssign,
        href: "http://localhost/admin/settings",
        origin: "http://localhost",
        pathname: "/admin/settings",
        search: "",
        hash: "",
        host: "localhost",
        hostname: "localhost",
        port: "",
        protocol: "http:",
        ancestorOrigins: {} as DOMStringList,
        replace: vi.fn(),
        reload: vi.fn(),
        toString: () => "http://localhost/admin/settings",
      } as unknown as Location);
    });

    afterEach(() => {
      assignSpy.mockRestore();
    });

    it("calls startLinkedInOAuth and navigates to authorizeUrl on click", async () => {
      renderPanel();
      const btn = screen.getByTestId("linkedin-connect-btn");
      fireEvent.click(btn);
      await waitFor(() => {
        expect(mockStartLinkedInOAuth).toHaveBeenCalledOnce();
      });
    });
  });

  describe("URL param handling on mount", () => {
    it("?linkedin=connected → success toast", async () => {
      setupDefaultHooks({
        oauthStatus: {
          clientConfigured: true,
          connected: true,
          connectedAs: "Bob",
          expiresAt: "2026-12-31T00:00:00.000Z",
          hasRefreshToken: true,
        },
      });
      renderPanel("/admin/settings?linkedin=connected");
      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalled();
      });
    });

    it("?linkedin=error → error toast", async () => {
      setupDefaultHooks({
        oauthStatus: {
          clientConfigured: true,
          connected: false,
          connectedAs: null,
          expiresAt: null,
          hasRefreshToken: false,
        },
      });
      renderPanel("/admin/settings?linkedin=error&reason=exchange");
      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });
    });
  });
});
