import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import { SourcesSection } from "../../../../src/components/settings/SourcesSection";
import {
  normalizeTwitterConfigForSubmit,
  type SettingsFormValues,
  type TwitterFormConfig,
} from "../../../../src/pages/settingsSchema";

interface WrapperProps {
  initialTwitter?: TwitterFormConfig | null;
  onSubmit?: (values: SettingsFormValues) => void;
}

function TestWrapper({
  initialTwitter = {
    listIds: [],
    users: [],
    maxTweetsPerSource: 50,
    sinceHours: 24,
  },
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
      webEnabled: false,
      webConfig: null,
      twitterEnabled: initialTwitter !== null,
      twitterConfig: initialTwitter,
      scheduleTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  return (
    <form
      onSubmit={(e) => {
        if (!onSubmit) return;
        void handleSubmit((values) => {
          onSubmit(values);
        })(e);
      }}
    >
      <SourcesSection control={control} register={register} setValue={setValue} />
      <button type="submit">submit</button>
    </form>
  );
}

function openTwitterEditPanel(): void {
  const editBtns = screen.getAllByRole("button", { name: /edit/i });
  // Twitter is the 4th source row; HN/Reddit/Web disabled because null.
  const enabledBtns = editBtns.filter(
    (btn) => !(btn as HTMLButtonElement).disabled,
  );
  if (enabledBtns.length === 0) throw new Error("No enabled Edit button found");
  // The Twitter row is the only enabled one in this wrapper.
  fireEvent.click(enabledBtns[enabledBtns.length - 1]);
}

afterEach(() => {
  cleanup();
});

describe("TwitterEditPanel rendering", () => {
  it("REQ-040: renders Twitter section with empty list/user editors and the two scalar inputs", () => {
    render(<TestWrapper />);
    openTwitterEditPanel();

    expect(screen.getByText(/twitter lists/i)).toBeTruthy();
    expect(screen.getByText(/twitter users/i)).toBeTruthy();
    expect(screen.getByLabelText(/max tweets per source/i)).toBeTruthy();
    expect(screen.getByLabelText(/since \(hours\)/i)).toBeTruthy();
    expect(screen.queryAllByPlaceholderText("1585430245762441216")).toHaveLength(0);
    expect(screen.queryAllByPlaceholderText("@jack")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /add list/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add user/i })).toBeTruthy();
  });
});

describe("TwitterEditPanel — list dynamic array", () => {
  it("REQ-040b: clicking Add list appends an input row; typing fills it; Remove removes it", () => {
    render(<TestWrapper />);
    openTwitterEditPanel();

    fireEvent.click(screen.getByRole("button", { name: /add list/i }));
    let inputs = screen.getAllByPlaceholderText("1585430245762441216");
    expect(inputs).toHaveLength(1);

    fireEvent.change(inputs[0], { target: { value: "1585430245762441216" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("1585430245762441216");

    fireEvent.click(screen.getByRole("button", { name: /add list/i }));
    inputs = screen.getAllByPlaceholderText("1585430245762441216");
    expect(inputs).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /remove list 1/i }));
    inputs = screen.getAllByPlaceholderText("1585430245762441216");
    expect(inputs).toHaveLength(1);
  });
});

describe("TwitterEditPanel — user dynamic array", () => {
  it("REQ-040c: clicking Add user appends a handle input row; typing fills; Remove works", () => {
    render(<TestWrapper />);
    openTwitterEditPanel();

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    let inputs = screen.getAllByPlaceholderText("@jack");
    expect(inputs).toHaveLength(1);

    fireEvent.change(inputs[0], { target: { value: "@jack" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("@jack");

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    inputs = screen.getAllByPlaceholderText("@jack");
    expect(inputs).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /remove handle 1/i }));
    inputs = screen.getAllByPlaceholderText("@jack");
    expect(inputs).toHaveLength(1);
  });
});

describe("Submission normalization", () => {
  it("REQ-041 / EDGE-014: drops empty/whitespace rows and strips leading @", () => {
    const config: TwitterFormConfig = {
      listIds: [
        { value: "1585430245762441216" },
        { value: "   " },
        { value: "" },
      ],
      users: [
        { handle: "@jack", userId: "" },
        { handle: "  ", userId: "" },
        { handle: "elonmusk", userId: "44196397" },
      ],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    };
    const result = normalizeTwitterConfigForSubmit(config);
    expect(result).not.toBeNull();
    expect(result?.listIds).toEqual(["1585430245762441216"]);
    expect(result?.users).toEqual([
      { handle: "jack" },
      { handle: "elonmusk", userId: "44196397" },
    ]);
  });

  it("REQ-042 / EDGE-015: all rows empty after trimming → returns null", () => {
    const config: TwitterFormConfig = {
      listIds: [{ value: "" }, { value: "  " }],
      users: [{ handle: "  ", userId: "" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    };
    const result = normalizeTwitterConfigForSubmit(config);
    expect(result).toBeNull();
  });
});

describe("API error surfacing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REQ-046 (UI side): 422 from API throws SettingsApiError with per-handle failures", async () => {
    const response = new Response(
      JSON.stringify({
        error: "twitter handle resolution failed",
        failures: [{ handle: "doesnotexist", reason: "user_not_found" }],
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response)),
    );
    const { putSettings, SettingsApiError } = await import(
      "../../../../src/api/settings"
    );

    let caught: unknown;
    try {
      await putSettings({
        topN: 12,
        halfLifeHours: 24,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: true,
        twitterConfig: { listIds: [], users: [{ handle: "doesnotexist" }] },
        scheduleTime: "07:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SettingsApiError);
    if (!(caught instanceof SettingsApiError)) throw new Error("wrong type");
    expect(caught.status).toBe(422);
    expect(caught.failures).toEqual([
      { handle: "doesnotexist", reason: "user_not_found" },
    ]);
  });

  it("REQ-047 (UI side): 503 from API throws SettingsApiError with RETTIWT_API_KEY message", async () => {
    const response = new Response(
      JSON.stringify({
        error:
          "twitter handle resolution unavailable: auth failed (rotate RETTIWT_API_KEY)",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response)),
    );
    const { putSettings, SettingsApiError } = await import(
      "../../../../src/api/settings"
    );

    let caught: unknown;
    try {
      await putSettings({
        topN: 12,
        halfLifeHours: 24,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: true,
        twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
        scheduleTime: "07:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SettingsApiError);
    if (!(caught instanceof SettingsApiError)) throw new Error("wrong type");
    expect(caught.status).toBe(503);
    expect(caught.message).toMatch(/RETTIWT_API_KEY/);
  });
});
