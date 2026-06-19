/**
 * P11 unit: onboarding wizard page.
 *
 * REQ-030 — saved progress restores fields + step on mount.
 * REQ-034 — live preview reflects name/headline slots; lorem placeholders
 *           where empty.
 * REQ-033 — slug field reports available / taken / reserved states.
 * REQ-036 — Generate prompts fills two EDITABLE textareas (API mocked).
 * REQ-037/051 — discovery renders click-to-add pills; nothing is added
 *           until a pill is clicked (API mocked).
 * REQ-038 — Activate is disabled while required steps are missing and the
 *           missing steps are listed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type {
  AuthMeResponse,
  OnboardingStateResponse,
} from "@newsletter/shared/types/tenant";
import { OnboardingPage } from "../../../src/pages/OnboardingPage";

vi.mock("../../../src/api/auth", () => ({
  fetchMe: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("../../../src/api/onboarding", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/onboarding")
  >("../../../src/api/onboarding");
  return {
    ActivationBlockedError: actual.ActivationBlockedError,
    getOnboarding: vi.fn(),
    patchOnboarding: vi.fn(),
    checkSlugAvailable: vi.fn(),
    generatePrompts: vi.fn(),
    discoverSources: vi.fn(),
    uploadLogo: vi.fn(),
    activateOnboarding: vi.fn(),
  };
});

vi.mock("../../../src/api/sources", () => ({
  fetchTenantSources: vi.fn(),
  addTenantSource: vi.fn(),
  removeTenantSource: vi.fn(),
  setTenantSourceEnabled: vi.fn(),
}));

// Fix #2: the social step now renders live OAuth connect controls.
const disconnectedStatus = {
  data: {
    clientConfigured: true,
    connected: false,
    connectedAs: null,
    expiresAt: null,
    hasRefreshToken: false,
  },
  isLoading: false,
  refetch: vi.fn(),
};
vi.mock("../../../src/api/socialCredentials", () => ({
  useLinkedInOAuthStatus: vi.fn(() => disconnectedStatus),
  startLinkedInOAuth: vi.fn(),
  useTwitterOAuthStatus: vi.fn(() => disconnectedStatus),
  startTwitterOAuth: vi.fn(),
  useDeleteSocialCredentials: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { fetchMe } from "../../../src/api/auth";
import {
  activateOnboarding,
  checkSlugAvailable,
  discoverSources,
  generatePrompts,
  getOnboarding,
  patchOnboarding,
} from "../../../src/api/onboarding";
import { addTenantSource, fetchTenantSources } from "../../../src/api/sources";
import type { TenantSourceWire } from "@newsletter/shared/types";

const mockFetchMe = vi.mocked(fetchMe);
const mockGetOnboarding = vi.mocked(getOnboarding);
const mockPatchOnboarding = vi.mocked(patchOnboarding);
const mockCheckSlug = vi.mocked(checkSlugAvailable);
const mockGeneratePrompts = vi.mocked(generatePrompts);
const mockDiscoverSources = vi.mocked(discoverSources);
const mockActivate = vi.mocked(activateOnboarding);
const mockFetchSources = vi.mocked(fetchTenantSources);
const mockAddSource = vi.mocked(addTenantSource);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SESSION: AuthMeResponse = {
  user: {
    id: "u1",
    tenantId: "t1",
    email: "a@b.c",
    name: "A",
    role: "tenant_admin",
  },
  tenant: { id: "t1", slug: "pending-x", name: "A", status: "pending_setup" },
};

const COMPLETE_DATA = {
  name: "The Inference",
  slug: "theinference",
  headline: "The daily read for inference.",
  topicStrip: "Serving · Quantization",
  subtagline: "Just the runtime.",
  blurb: "Practical LLM inference.",
  rankingPrompt: "Rank by usefulness.",
  shortlistPrompt: "Keep inference items.",
  pipelineTime: "06:00",
  emailTime: "07:30",
  timezone: "UTC",
};

function makeResponse(
  overrides: Partial<OnboardingStateResponse> = {},
): OnboardingStateResponse {
  return {
    status: "pending_setup",
    state: null,
    hasLogo: false,
    sourcesCount: 0,
    ...overrides,
  };
}

function makeSource(name: string): TenantSourceWire {
  return {
    id: `src-${name}`,
    type: "hn",
    name,
    config: { kind: "hn", sinceDays: 1 },
    enabled: true,
    health: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
}

function renderPage(): void {
  mockFetchMe.mockResolvedValue(SESSION);
  mockPatchOnboarding.mockResolvedValue({
    state: { currentStep: "name", completedSteps: [] },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/onboarding"]}>
        <OnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function previewPane(): HTMLElement {
  return screen.getByRole("complementary", { name: /live preview/i });
}

describe("Fix #2: social step OAuth connect controls", () => {
  it("renders Connect LinkedIn + Connect Twitter on the social step", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({ state: { currentStep: "social", completedSteps: [] } }),
    );
    mockFetchSources.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("linkedin-connect-btn")).toBeTruthy();
    });
    expect(screen.getByTestId("linkedin-connect-btn").textContent).toContain(
      "Connect LinkedIn",
    );
    expect(screen.getByTestId("twitter-connect-btn").textContent).toContain(
      "Connect Twitter",
    );
  });
});

describe("test_REQ_030_wizard_progress_resumes (UI)", () => {
  it("restores the saved step and field values on mount", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({
        state: {
          currentStep: "homepage",
          completedSteps: ["name", "slug"],
          data: {
            name: "The Inference",
            slug: "theinference",
            headline: "The daily read for inference.",
          },
        },
      }),
    );
    mockFetchSources.mockResolvedValue([]);
    renderPage();

    // Opens on the saved step…
    expect(
      await screen.findByRole("heading", {
        name: /your homepage text/i,
        level: 2,
      }),
    ).toBeTruthy();
    // …with the saved field values restored.
    expect(screen.getByLabelText(/^Headline$/i)).toHaveProperty(
      "value",
      "The daily read for inference.",
    );
  });
});

describe("test_REQ_034_live_preview_reflects_branding (unit level)", () => {
  it("shows lorem-ipsum placeholders when slots are empty", async () => {
    mockGetOnboarding.mockResolvedValue(makeResponse());
    mockFetchSources.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /name your newsletter/i, level: 2 });

    const pane = previewPane();
    expect(within(pane).getByText("Your newsletter")).toBeTruthy();
    expect(
      within(pane).getByText(/Lorem ipsum dolor sit amet/i),
    ).toBeTruthy();
  });

  it("reflects the typed name and headline live", async () => {
    mockGetOnboarding.mockResolvedValue(makeResponse());
    mockFetchSources.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /name your newsletter/i, level: 2 });

    fireEvent.change(screen.getByLabelText(/newsletter name/i), {
      target: { value: "The Inference" },
    });
    expect(within(previewPane()).getByText("The Inference")).toBeTruthy();
  });
});

describe("test_REQ_033_slug_states (UI)", () => {
  it.each([
    ["taken", /is taken/i],
    ["reserved", /reserved and can.t be used/i],
    ["available", /is available/i],
  ] as const)("reports a %s slug", async (status, expected) => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({ state: { currentStep: "slug", completedSteps: [] } }),
    );
    mockFetchSources.mockResolvedValue([]);
    mockCheckSlug.mockResolvedValue({ slug: "candidate", status });
    renderPage();
    await screen.findByRole("heading", { name: /pick your address/i, level: 2 });

    fireEvent.change(screen.getByLabelText(/subdomain/i), {
      target: { value: "candidate" },
    });
    expect(await screen.findByText(expected, {}, { timeout: 3000 })).toBeTruthy();
    expect(mockCheckSlug).toHaveBeenCalledWith("candidate");
  });
});

describe("test_REQ_036_generates_ranking_and_shortlist_prompts (UI, stubbed)", () => {
  it("fills two editable prompt textareas from the stubbed generator", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({ state: { currentStep: "prompts", completedSteps: [] } }),
    );
    mockFetchSources.mockResolvedValue([]);
    mockGeneratePrompts.mockResolvedValue({
      rankingPrompt: "Generated ranking prompt.",
      shortlistPrompt: "Generated shortlist prompt.",
    });
    renderPage();
    await screen.findByRole("heading", { name: /tune what gets picked/i, level: 2 });

    fireEvent.change(
      screen.getByLabelText(/what.s your newsletter about/i),
      { target: { value: "Practical LLM inference." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /generate prompts/i }));

    const ranking = await screen.findByLabelText(/ranking prompt/i);
    const shortlist = screen.getByLabelText(/shortlist prompt/i);
    expect(ranking).toHaveProperty("value", "Generated ranking prompt.");
    expect(shortlist).toHaveProperty("value", "Generated shortlist prompt.");
    expect(mockGeneratePrompts).toHaveBeenCalledWith(
      "Practical LLM inference.",
    );

    // Both prompts are EDITABLE (REQ-036).
    fireEvent.change(ranking, { target: { value: "My edited ranking." } });
    expect(ranking).toHaveProperty("value", "My edited ranking.");
  });
});

describe("test_REQ_037_source_pills_add_and_manual (UI, stubbed)", () => {
  it("renders discovered candidates; nothing is added until a pill is clicked", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({
        state: {
          currentStep: "sources",
          completedSteps: [],
          data: { blurb: "Practical LLM inference." },
        },
      }),
    );
    mockFetchSources.mockResolvedValue([]);
    mockDiscoverSources.mockResolvedValue({
      candidates: [
        {
          type: "reddit",
          value: "LocalLLaMA",
          label: "r/LocalLLaMA",
          group: "Reddit",
        },
        {
          type: "rss",
          value: "https://blog.vllm.ai",
          label: "vLLM blog",
          group: "RSS / Blogs",
        },
      ],
    });
    mockAddSource.mockResolvedValue(makeSource("r/LocalLLaMA"));
    renderPage();
    await screen.findByRole("heading", { name: /choose your sources/i, level: 2 });

    fireEvent.click(screen.getByRole("button", { name: /discover sources/i }));
    const pill = await screen.findByRole("button", { name: /r\/LocalLLaMA/i });
    expect(screen.getByRole("button", { name: /vLLM blog/i })).toBeTruthy();

    // REQ-037/051: suggestions alone add NOTHING.
    expect(mockAddSource).not.toHaveBeenCalled();

    fireEvent.click(pill);
    await waitFor(() => {
      // (TanStack v5 passes a context object as mutationFn's 2nd arg —
      // assert on the variables only.)
      expect(mockAddSource.mock.calls[0]?.[0]).toEqual({
        type: "reddit",
        value: "LocalLLaMA",
      });
    });
  });

  it("adds a manual source", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({ state: { currentStep: "sources", completedSteps: [] } }),
    );
    mockFetchSources.mockResolvedValue([]);
    mockAddSource.mockResolvedValue(makeSource("blog.example.com"));
    renderPage();
    await screen.findByRole("heading", { name: /choose your sources/i, level: 2 });

    fireEvent.change(screen.getByLabelText(/add manually/i), {
      target: { value: "https://blog.example.com/feed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => {
      expect(mockAddSource.mock.calls[0]?.[0]).toEqual({
        type: "rss",
        value: "https://blog.example.com/feed",
      });
    });
  });
});

describe("test_REQ_038_activation_blocked_lists_missing (UI)", () => {
  it("disables Activate and lists the missing required steps", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({
        state: {
          currentStep: "schedule",
          completedSteps: [],
          data: {
            slug: "theinference",
            pipelineTime: "06:00",
            emailTime: "07:30",
            timezone: "UTC",
          },
        },
      }),
    );
    mockFetchSources.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /set your schedule/i, level: 2 });

    const activate = screen.getByRole("button", {
      name: /activate newsletter/i,
    });
    expect(activate).toHaveProperty("disabled", true);
    expect(mockActivate).not.toHaveBeenCalled();

    const missing = screen.getByRole("list", { name: /remaining steps/i });
    expect(within(missing).getByText(/newsletter name/i)).toBeTruthy();
    expect(within(missing).getByText(/homepage text/i)).toBeTruthy();
    expect(within(missing).getByText(/prompts/i)).toBeTruthy();
    expect(within(missing).getByText(/sources/i)).toBeTruthy();
    expect(within(missing).queryByText(/subdomain/i)).toBeNull();
    expect(within(missing).queryByText(/schedule/i)).toBeNull();
  });

  it("enables Activate when everything required is complete and activates", async () => {
    mockGetOnboarding.mockResolvedValue(
      makeResponse({
        state: {
          currentStep: "schedule",
          completedSteps: [],
          data: COMPLETE_DATA,
        },
        sourcesCount: 1,
      }),
    );
    mockFetchSources.mockResolvedValue([makeSource("Hacker News")]);
    mockActivate.mockResolvedValue({ ok: true, slug: "theinference" });
    renderPage();
    await screen.findByRole("heading", { name: /set your schedule/i, level: 2 });

    const activate = await screen.findByRole("button", {
      name: /activate newsletter/i,
    });
    await waitFor(() => {
      expect(activate).toHaveProperty("disabled", false);
    });
    fireEvent.click(activate);
    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledTimes(1);
    });
  });
});
