import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import {
  SourcesSection,
  summarizeWebSearch,
} from "../../../../src/components/settings/SourcesSection";
import {
  normalizeSettingsForSubmit,
  type SettingsSubmitInput,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";
import type { RunSubmitWebSearchConfig } from "@newsletter/shared/types";

interface WrapperProps {
  initialSources?: { name: string; listingUrl: string }[];
  webEnabled?: boolean;
  webSearchEnabled?: boolean;
  webSearchConfig?: RunSubmitWebSearchConfig | null;
  onSubmit?: (input: SettingsSubmitInput) => void;
}

function TestWrapper({
  initialSources = [],
  webEnabled = true,
  webSearchEnabled = false,
  webSearchConfig = null,
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
      webSearchEnabled,
      webSearchConfig,
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

describe("summarizeWebSearch", () => {
  it("returns Disabled for null", () => {
    expect(summarizeWebSearch(null)).toBe("Disabled");
  });

  it("returns Disabled when queries is empty", () => {
    expect(summarizeWebSearch({ provider: "tavily", queries: [] })).toBe(
      "Disabled",
    );
  });

  it("describes the configured queries", () => {
    expect(
      summarizeWebSearch({
        provider: "tavily",
        queries: [{ query: "agentic AI", sinceDays: 7, maxItems: 10 }],
      }),
    ).toBe("1 query · tavily · last 7 days");
  });

  it("uses the max sinceDays across queries", () => {
    expect(
      summarizeWebSearch({
        provider: "tavily",
        queries: [
          { query: "a", sinceDays: 3, maxItems: 5 },
          { query: "b", sinceDays: 14, maxItems: 5 },
        ],
      }),
    ).toBe("2 queries · tavily · last 14 days");
  });
});

describe("Web Search card", () => {
  function openWebSearchPanel(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /web search edit/i }),
    );
  }

  it("renders the configured query in an input when enabled", () => {
    render(
      <TestWrapper
        webSearchEnabled
        webSearchConfig={{
          provider: "tavily",
          queries: [{ query: "agentic AI", sinceDays: 7, maxItems: 10 }],
        }}
      />,
    );
    openWebSearchPanel();
    expect(screen.getByDisplayValue("agentic AI")).toBeTruthy();
  });

  it("shows Disabled summary when webSearch is disabled with null config", () => {
    render(<TestWrapper webSearchEnabled={false} webSearchConfig={null} />);
    const card = screen.getByTestId("web-search-card");
    expect(card.textContent).toContain("Disabled");
  });
});
