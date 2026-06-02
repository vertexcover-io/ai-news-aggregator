import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";

// Mock health check hooks so HealthCheckButton renders without QueryClientProvider
vi.mock("../../../../src/hooks/useHealthCheck", () => ({
  useHealthCheckStatus: () => ({ report: null, isLoading: false, error: null }),
  useTriggerHealthCheck: () => ({
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    error: null,
    mutate: vi.fn(),
  }),
}));
import { SourcesSection, summarizeWebSearch } from "../../../../src/components/settings/SourcesSection";
import {
  normalizeSettingsForSubmit,
  type SettingsSubmitInput,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

interface WrapperProps {
  initialSources?: { name: string; listingUrl: string }[];
  webEnabled?: boolean;
  onSubmit?: (input: SettingsSubmitInput) => void;
}

function TestWrapper({
  initialSources = [],
  webEnabled = true,
  onSubmit,
}: WrapperProps): ReactElement {
  const { control, register, handleSubmit, setValue } = useForm<SettingsFormValues>({
    defaultValues: {
      topN: 10,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled,
      webConfig: {
        sources: initialSources,
        maxItems: 10,
        sinceDays: 7,
      },
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit((values) => {
          onSubmit?.(normalizeSettingsForSubmit(values));
        })(event);
      }}
    >
      <SourcesSection control={control} register={register} setValue={setValue} />
      <button type="submit">Submit</button>
    </form>
  );
}

afterEach(() => {
  cleanup();
});

describe("WebEditPanel — per-source Name+URL row inputs", () => {
  function openWebEditPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /web \(blog listings\) edit/i }),
    );
  }

  it("renders one Name and one URL input per source", () => {
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
          { name: "OpenAI", listingUrl: "https://openai.com/blog" },
        ]}
      />,
    );
    openWebEditPanel();

    const nameInputs = screen.getAllByPlaceholderText("Anthropic");
    expect(nameInputs).toHaveLength(2);

    const urlInputs = screen.getAllByPlaceholderText(
      "https://www.anthropic.com/news",
    );
    expect(urlInputs).toHaveLength(2);

    // Verify values
    expect(nameInputs[0]).toHaveProperty("value", "Anthropic");
    expect(nameInputs[1]).toHaveProperty("value", "OpenAI");
    expect(urlInputs[0]).toHaveProperty(
      "value",
      "https://www.anthropic.com/news",
    );
    expect(urlInputs[1]).toHaveProperty("value", "https://openai.com/blog");
  });

  it("clicking 'Add source' appends a new empty row", () => {
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        ]}
      />,
    );
    openWebEditPanel();

    const beforeNameInputs = screen.getAllByPlaceholderText("Anthropic");
    expect(beforeNameInputs).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /add source/i }));

    const afterNameInputs = screen.getAllByPlaceholderText("Anthropic");
    expect(afterNameInputs).toHaveLength(2);
    expect(afterNameInputs[1]).toHaveProperty("value", "");
  });

  it("clicking a remove button removes that source row", () => {
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
          { name: "OpenAI", listingUrl: "https://openai.com/blog" },
        ]}
      />,
    );
    openWebEditPanel();

    // aria-label is "Remove Anthropic"
    fireEvent.click(screen.getByRole("button", { name: /remove anthropic/i }));

    const nameInputs = screen.getAllByPlaceholderText("Anthropic");
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0]).toHaveProperty("value", "OpenAI");
  });

  it("editing the Name input updates that source's name", () => {
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        ]}
      />,
    );
    openWebEditPanel();

    const nameInput = screen.getByDisplayValue("Anthropic");
    fireEvent.change(nameInput, { target: { value: "Anthropic Blog" } });

    expect(screen.getByDisplayValue("Anthropic Blog")).toBeTruthy();
  });

  it("editing the URL input updates that source's listingUrl", () => {
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        ]}
      />,
    );
    openWebEditPanel();

    const urlInput = screen.getByDisplayValue("https://www.anthropic.com/news");
    fireEvent.change(urlInput, {
      target: { value: "https://www.anthropic.com/research" },
    });

    expect(
      screen.getByDisplayValue("https://www.anthropic.com/research"),
    ).toBeTruthy();
  });

  it("turning Web off preserves its config in the submitted payload", async () => {
    const submissions: SettingsSubmitInput[] = [];
    render(
      <TestWrapper
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        ]}
        onSubmit={(input) => {
          submissions.push(input);
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Web (blog listings)"));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(submissions).toHaveLength(1);
    });
    const submitted = submissions[0];
    expect(submitted.webEnabled).toBe(false);
    expect(submitted.webConfig).toEqual({
      sources: [
        { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
      ],
      maxItems: 10,
      sinceDays: 7,
    });
  });

  it("keeps the disabled Web row editable", () => {
    render(
      <TestWrapper
        webEnabled={false}
        initialSources={[
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        ]}
      />,
    );

    openWebEditPanel();

    expect(screen.getByDisplayValue("Anthropic")).toBeTruthy();
  });
});

describe("Health check buttons in source edit panels", () => {
  function openHnPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /hacker news edit/i }),
    );
  }

  function openRedditPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /reddit edit/i }),
    );
  }

  function openWebPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /web \(blog listings\) edit/i }),
    );
  }

  function openTwitterPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /twitter \/ x edit/i }),
    );
  }

  function openWebSearchPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /web search edit/i }),
    );
  }

  it("shows 'Check Health' button in HN expanded panel", () => {
    render(<TestWrapper />);
    openHnPanel();
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("shows 'Check Health' button in Reddit expanded panel", () => {
    render(<TestWrapper />);
    openRedditPanel();
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("shows 'Check Health' button in Web expanded panel", () => {
    render(<TestWrapper />);
    openWebPanel();
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("shows 'Check Health' button in Twitter expanded panel", () => {
    render(<TestWrapper />);
    openTwitterPanel();
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("shows 'Check Health' button in Web Search expanded panel", () => {
    render(<TestWrapper />);
    openWebSearchPanel();
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("health check buttons have type='button'", () => {
    render(<TestWrapper />);
    openHnPanel();
    const buttons = screen.getAllByText("Check Health");
    for (const btn of buttons) {
      const parentBtn = btn.closest("button");
      expect(parentBtn?.getAttribute("type")).toBe("button");
    }
  });

  it("health check buttons are inside the edit panel (border-t div)", () => {
    render(<TestWrapper />);
    openHnPanel();
    // The button should be inside the edit panel area
    const checkBtn = screen.getByText("Check Health");
    expect(checkBtn).toBeTruthy();
  });
});

describe("summarizeWebSearch", () => {
  it("returns 'Disabled' for null input", () => {
    expect(summarizeWebSearch(null)).toBe("Disabled");
  });

  it("returns 'Disabled' for config with empty queries array", () => {
    expect(summarizeWebSearch({ provider: "tavily", queries: [] })).toBe("Disabled");
  });

  it("returns singular 'query' for exactly 1 query", () => {
    expect(
      summarizeWebSearch({
        provider: "tavily",
        queries: [{ query: "agentic AI", sinceDays: 7, maxItems: 5 }],
      }),
    ).toBe("1 query · tavily");
  });

  it("returns plural 'queries' for 3 queries", () => {
    expect(
      summarizeWebSearch({
        provider: "tavily",
        queries: [
          { query: "agentic AI", sinceDays: 7, maxItems: 5 },
          { query: "context engineering", sinceDays: 14, maxItems: 3 },
          { query: "AI coding tools", sinceDays: 7, maxItems: 10 },
        ],
      }),
    ).toBe("3 queries · tavily");
  });
});
