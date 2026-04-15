import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import { SourcesSection } from "../../../../src/components/settings/SourcesSection";
import type { SettingsFormValues } from "../../../../src/pages/settingsSchema";

interface WrapperProps {
  initialSources?: { name: string; listingUrl: string }[];
}

function TestWrapper({ initialSources = [] }: WrapperProps): ReactElement {
  const { control } = useForm<SettingsFormValues>({
    defaultValues: {
      profileName: "default",
      topN: 10,
      halfLifeHours: null,
      hnConfig: null,
      redditConfig: null,
      webConfig: {
        sources: initialSources,
        maxItems: 10,
        sinceDays: 7,
      },
      scheduleTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  return (
    <form>
      <SourcesSection control={control} />
    </form>
  );
}

afterEach(() => {
  cleanup();
});

describe("WebEditPanel — per-source Name+URL row inputs", () => {
  function openWebEditPanel(): void {
    // There are three Edit buttons (HN, Reddit, Web). HN and Reddit are disabled
    // because those configs are null. Find the enabled one (Web).
    const editBtns = screen.getAllByRole("button", { name: /edit/i });
    const enabledBtn = editBtns.find(
      (btn) => !(btn as HTMLButtonElement).disabled,
    );
    if (!enabledBtn) throw new Error("No enabled Edit button found");
    fireEvent.click(enabledBtn);
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
});
