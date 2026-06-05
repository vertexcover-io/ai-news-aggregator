import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { DigestMeta } from "@newsletter/shared/constants";
import {
  DigestMetaPanel,
  type DigestMetaValues,
  type RegenerateItem,
} from "../../../../src/components/review/DigestMetaPanel";

vi.mock("../../../../src/api/archives", () => ({
  regenerateDigestMeta: vi.fn(),
}));

import { regenerateDigestMeta } from "../../../../src/api/archives";

function fieldValue(label: string): string {
  const el = screen.getByLabelText(label);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  throw new Error(`expected an input/textarea for "${label}"`);
}

function regenerateButton(): HTMLButtonElement {
  const el = screen.getByRole("button", { name: /regenerate/i });
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("expected the Regenerate button");
  }
  return el;
}

function items(): RegenerateItem[] {
  return [
    { id: 1, title: "Story one", summary: "s1", bottomLine: "b1" },
    { id: 2, title: "Story two", summary: "s2", bottomLine: "b2" },
  ];
}

function seed(): DigestMetaValues {
  return {
    headline: "Initial headline",
    summary: "Initial summary",
    hook: "Initial hook",
    twitterSummary: "Initial twitter",
    linkedinPostBody: "Initial LinkedIn body",
  };
}

function renderPanel(props: {
  values?: DigestMetaValues;
  items?: RegenerateItem[];
  onChange?: (v: DigestMetaValues) => void;
}): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <DigestMetaPanel
          runId="run-1"
          items={props.items ?? items()}
          values={props.values ?? seed()}
          onChange={props.onChange ?? onChange}
        />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return { onChange };
}

beforeEach(() => {
  vi.mocked(regenerateDigestMeta).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DigestMetaPanel", () => {
  it("REQ-015: renders labeled fields seeded with initial values", () => {
    renderPanel({});
    expect(fieldValue("Headline")).toBe("Initial headline");
    expect(fieldValue("Summary")).toBe("Initial summary");
    expect(fieldValue("LinkedIn post")).toBe("Initial LinkedIn body");
    expect(fieldValue("Twitter Summary")).toBe("Initial twitter");
  });

  it("Admin can edit the LinkedIn post body inline", () => {
    let current = seed();
    const onChange = vi.fn((v: DigestMetaValues) => {
      current = v;
    });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    function Harness(): ReactElement {
      return (
        <QueryClientProvider client={client}>
          <DigestMetaPanel
            runId="run-1"
            items={items()}
            values={current}
            onChange={onChange}
          />
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByTestId("linkedin-post-body"), {
      target: { value: "Admin-edited post body" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ linkedinPostBody: "Admin-edited post body" }),
    );
  });

  it("Regenerate overwrites headline/summary/twitterSummary and rebuilds the LinkedIn body from current stories", async () => {
    const fresh: DigestMeta = {
      headline: "Fresh headline",
      summary: "Fresh summary",
      hook: "LLM-Hook-IGNORED",
      twitterSummary: "Fresh twitter",
    };
    vi.mocked(regenerateDigestMeta).mockResolvedValue(fresh);

    let current = seed();
    const onChange = vi.fn((v: DigestMetaValues) => {
      current = v;
    });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    function Harness(): ReactElement {
      return (
        <QueryClientProvider client={client}>
          <DigestMetaPanel
            runId="run-1"
            items={items()}
            values={current}
            onChange={onChange}
          />
        </QueryClientProvider>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    await waitFor(() => {
      expect(vi.mocked(regenerateDigestMeta)).toHaveBeenCalledWith("run-1", items());
    });
    await waitFor(() => {
      expect(current.headline).toBe("Fresh headline");
    });
    expect(current.summary).toBe("Fresh summary");
    expect(current.twitterSummary).toBe("Fresh twitter");
    expect(current.linkedinPostBody).toContain("AgentLoop — Today in Agentic Engineering");
    expect(current.linkedinPostBody).toContain("→ s1");
    expect(current.linkedinPostBody).toContain("→ s2");
    expect(current.linkedinPostBody).toContain("Full newsletter linked in the comments.");
  });

  it("REQ-017: Regenerate button is disabled and shows a loading affordance while in flight", async () => {
    let resolve: (v: DigestMeta) => void = () => undefined;
    vi.mocked(regenerateDigestMeta).mockImplementation(
      () =>
        new Promise<DigestMeta>((r) => {
          resolve = r;
        }),
    );
    renderPanel({});
    const button = regenerateButton();
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.disabled).toBe(true);
    });
    expect(screen.getByText(/regenerating/i)).toBeTruthy();

    resolve({
      headline: "h",
      summary: "s",
      hook: "k",
      twitterSummary: "t",
    });
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });

  it("REQ-018: failed regenerate shows an error and leaves fields unchanged", async () => {
    vi.mocked(regenerateDigestMeta).mockRejectedValue(
      new Error("digest regeneration failed: boom"),
    );
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
    expect(onChange).not.toHaveBeenCalled();
    expect(fieldValue("Headline")).toBe("Initial headline");
  });

  it("EDGE-003: Twitter Summary over 180 chars shows an over-limit warning but does not block typing", () => {
    let current = seed();
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    function Harness(): ReactElement {
      return (
        <QueryClientProvider client={client}>
          <DigestMetaPanel
            runId="run-1"
            items={items()}
            values={current}
            onChange={(v) => {
              current = v;
            }}
          />
        </QueryClientProvider>
      );
    }
    const { rerender } = render(<Harness />);

    const over = "x".repeat(181);
    const field = screen.getByLabelText("Twitter Summary");
    fireEvent.change(field, { target: { value: over } });
    rerender(<Harness />);

    // not blocked — the full 181-char value is reflected
    const after = screen.getByLabelText("Twitter Summary");
    if (!(after instanceof HTMLTextAreaElement)) {
      throw new Error("expected a textarea");
    }
    expect(after.value.length).toBe(181);
    const counter = screen.getByTestId("twitter-summary-counter");
    expect(counter.textContent).toContain("181");
    expect(counter.getAttribute("data-over-limit")).toBe("true");
  });

  it("EDGE-001: Regenerate is disabled when there are zero ranked items", () => {
    renderPanel({ items: [] });
    expect(regenerateButton().disabled).toBe(true);
  });

  // Phase 3 tests

  it("test_REQ_010_dry_run_disables_regenerate — disabled reason disables button with title/tooltip", () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    function Wrapper(): ReactElement {
      return (
        <QueryClientProvider client={client}>
          <DigestMetaPanel
            runId="run-dry"
            items={items()}
            values={seed()}
            onChange={vi.fn()}
            regenerateDisabledReason="Regeneration is unavailable for dry-run archives."
          />
        </QueryClientProvider>
      );
    }
    render(<Wrapper />);

    const btn = regenerateButton();
    expect(btn.disabled).toBe(true);
    // The disabled reason should be accessible via title or visible text
    const hasReason =
      btn.title.includes("dry-run") ||
      !!screen.queryByText(/dry-run/i) ||
      !!screen.queryByText(/unavailable/i);
    expect(hasReason).toBe(true);
  });
});
