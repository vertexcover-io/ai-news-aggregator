import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { SourcesSection } from "../../../../src/components/settings/SourcesSection";
import {
  settingsFormSchema,
  normalizeSettingsForSubmit,
  type SettingsFormValues,
  type SettingsSubmitInput,
} from "../../../../src/pages/settingsSchema";

// VS-6 regression: SettingsPage's Save button silently no-ops for Twitter
// dynamic-array changes. The existing TwitterEditPanel test wraps the form
// WITHOUT a zod resolver, so it can't catch validation rejections. This
// test uses the REAL zodResolver against the REAL settingsFormSchema and
// reproduces the EXACT user flow from the Stage-5 VS-6 finding.

interface SubmitHarnessProps {
  onValid: (input: SettingsSubmitInput) => void;
  onInvalid?: (errors: unknown) => void;
}

function SubmitHarness({
  onValid,
  onInvalid,
}: SubmitHarnessProps): ReactElement {
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    // Match the production SettingsPage defaults — Twitter starts disabled,
    // hn + reddit have non-null config, web is null.
    defaultValues: {
      topN: 12,
      halfLifeHours: 24,
      hnEnabled: true,
      hnConfig: {
        keywords: ["ai", "llm", "agents"],
        pointsThreshold: 100,
        sinceDays: 1,
        count: 50,
        feeds: ["newest", "best"],
        commentsPerItem: 10,
      },
      redditEnabled: true,
      redditConfig: {
        subreddits: ["MachineLearning", "LocalLLaMA"],
        sort: "hot",
        limit: 25,
        sinceDays: 1,
      },
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "07:00",
      scheduleTimezone: "Asia/Calcutta",
      scheduleEnabled: false,
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      onValid(normalizeSettingsForSubmit(values));
    },
    (errors) => {
      if (onInvalid) onInvalid(errors);
    },
  );

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
    >
      <SourcesSection
        control={form.control}
        register={form.register}
        setValue={form.setValue}
      />
      <button type="submit">submit</button>
    </form>
  );
}

describe("SourcesSection — Twitter form submit (VS-6 regression)", () => {
  afterEach(() => {
    cleanup();
  });

  it("VS-6: toggling Twitter on, adding a list + handle, then submitting fires onValid with normalized config", async () => {
    const onValid = vi.fn();
    const onInvalid = vi.fn();
    render(<SubmitHarness onValid={onValid} onInvalid={onInvalid} />);

    // 1. Toggle Twitter on
    const twitterSwitch = screen.getByRole("switch", { name: /twitter \/ x/i });
    fireEvent.click(twitterSwitch);

    // 2. Open the Twitter edit panel
    // The edit toggle is inside SourceRow — click the edit affordance for the
    // Twitter row. Look for the "Edit" button or chevron near the Twitter row.
    // From the existing TwitterEditPanel.test.tsx, the panel is rendered when
    // expanded — find the row's edit toggle by its aria-label or text.
    const editButtons = screen.getAllByRole("button", { name: /edit|configure/i });
    // The row order is hn, reddit, web, twitter — find the last edit button.
    const twitterEditBtn = editButtons[editButtons.length - 1];
    fireEvent.click(twitterEditBtn);

    // 3. Click "Add list" and type a list ID
    const addListBtn = screen.getByRole("button", { name: /add list/i });
    fireEvent.click(addListBtn);
    const listInput = screen.getByRole("textbox", { name: /twitter list 1/i });
    fireEvent.change(listInput, { target: { value: "1585430245762441216" } });

    // 4. Click "Add user" and type a handle
    const addUserBtn = screen.getByRole("button", { name: /add user/i });
    fireEvent.click(addUserBtn);
    const userInput = screen.getByRole("textbox", { name: /twitter handle 1/i });
    fireEvent.change(userInput, { target: { value: "sama" } });

    // 5. Click submit
    const submitBtn = screen.getByRole("button", { name: /^submit$/i });
    fireEvent.click(submitBtn);

    // Allow react-hook-form's async resolver to settle.
    await new Promise((r) => setTimeout(r, 50));

    // The bug: onValid was never called (zodResolver silently rejected
    // OR something blocked submission). After the fix, onValid must fire
    // with the normalized payload.
    expect(onInvalid).not.toHaveBeenCalled();
    expect(onValid).toHaveBeenCalledOnce();
    const submitted = onValid.mock.calls[0][0] as SettingsSubmitInput;
    expect(submitted.twitterConfig).toEqual({
      listIds: ["1585430245762441216"],
      users: [{ handle: "sama" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    });
  });
});
