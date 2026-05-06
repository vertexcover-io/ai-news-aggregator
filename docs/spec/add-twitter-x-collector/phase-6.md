# Phase 6: Settings UI (dynamic-array editor)

> **Status:** pending

## Overview

Adds a Twitter section to the settings UI. After this phase, the operator can paste handles (`@jack`) and list IDs (`1585...`) via Add buttons, with one input per row, and saving triggers the API to resolve handles + persist.

## Implementation

**Files:**
- Modify: `packages/web/src/components/settings/SourcesSection.tsx` — add a Twitter row to the existing source-list (mirroring the Reddit row), with a `TwitterEditPanel` sibling.
- Possibly create: `packages/web/src/components/settings/TwitterEditPanel.tsx` — the dynamic-array editor (kept as a sibling component for clarity, similar to how `RedditEditPanel` is a sub-section in the existing file).
- Modify: `packages/web/src/lib/api.ts` (or wherever the settings PUT call is wired) — surface 422 / 503 responses with handle-specific error toasts.
- Modify: `packages/web/src/pages/SettingsPage.tsx` — verify the new section is rendered (likely no change — the Source rows are already mapped in SourcesSection).
- New tests:
  - `packages/web/src/components/settings/__tests__/TwitterEditPanel.test.tsx` — render + Add/Remove/submit interactions.
  - Extend any existing settings page tests that assert the source list, to include Twitter.

**Pattern to follow:** `RedditEditPanel` in `SourcesSection.tsx:405-503` for the Controller-driven react-hook-form integration, and the visual treatment (chip-row, grid-cols-2, label+description). Diverge only in the dynamic-array structure.

### `TwitterEditPanel` shape

Two `useFieldArray`s — one for `listIds`, one for `users`. (`react-hook-form` ships `useFieldArray` for exactly this.) Plus two scalar inputs.

```tsx
const { fields: listFields, append: appendList, remove: removeList } =
  useFieldArray({ control, name: "twitterConfig.listIds" });

const { fields: userFields, append: appendUser, remove: removeUser } =
  useFieldArray({ control, name: "twitterConfig.users" });

return (
  <Stack>
    <Section title="Twitter Lists">
      {listFields.map((field, idx) => (
        <Row key={field.id}>
          <Input {...register(`twitterConfig.listIds.${idx}`)} placeholder="1585430245762441216" />
          <RemoveButton onClick={() => removeList(idx)} />
        </Row>
      ))}
      <AddButton onClick={() => appendList("")}>Add list</AddButton>
    </Section>
    <Section title="Twitter Users">
      {userFields.map((field, idx) => (
        <Row key={field.id}>
          <Input
            {...register(`twitterConfig.users.${idx}.handle`)}
            placeholder="@jack"
          />
          <RemoveButton onClick={() => removeUser(idx)} />
        </Row>
      ))}
      <AddButton onClick={() => appendUser({ handle: "", userId: "" })}>Add user</AddButton>
    </Section>
    <Grid cols={2}>
      <Input {...register("twitterConfig.maxTweetsPerSource")} type="number" min={1} max={500} />
      <Input {...register("twitterConfig.sinceHours")} type="number" min={1} max={168} />
    </Grid>
  </Stack>
);
```

(Names of `Section`/`Row`/`AddButton`/`Input` mirror existing settings components — match what's already there.)

### Submission shape transform

Before the `PUT /api/settings` call, transform the form state:

1. Drop list rows whose value is empty/whitespace.
2. For users, drop rows where `handle` is empty/whitespace, strip leading `@`, drop the `userId` field if it's an empty string (the API will resolve missing IDs).
3. If both `listIds` and `users` are empty arrays after step 1+2 → submit `twitterConfig: null` (REQ-042).
4. Otherwise submit `twitterConfig: { listIds, users, maxTweetsPerSource, sinceHours }`.

### Error UX

The API returns either 200, 422 (handle resolution failed), or 503 (RETTIWT_API_KEY missing / auth_failed). The settings page shows a toast/error banner with the failure reason. Resolved `userId` values come back in the 200 response — the UI updates the form state from the response so subsequent saves don't re-resolve.

### Tests

| Test | REQ |
|---|---|
| `renders Twitter section with empty list/user editors and the two scalar inputs` | REQ-040 |
| `clicking Add list appends an input row; typing fills it; Remove removes it` | REQ-040b |
| `clicking Add user appends a handle input; same flow` | REQ-040c |
| `submitting drops empty rows and strips leading @` | REQ-041, EDGE-014 |
| `submitting with all rows empty sends twitterConfig: null` | REQ-042, EDGE-015 |
| `422 from API surfaces a per-handle error message` | REQ-046 (UI side) |
| `503 from API surfaces an actionable banner ("rotate your RETTIWT_API_KEY")` | REQ-047 (UI side) |

**Traces to:** REQ-040, REQ-040b, REQ-040c, REQ-041, REQ-042, EDGE-014, EDGE-015.

**Commit:** `feat(twitter): settings UI dynamic-array editor`

## Done when

- [ ] `pnpm --filter @newsletter/web test:unit` passes with new tests.
- [ ] `pnpm typecheck` and `pnpm lint` clean.
- [ ] Manual smoke (later, in Stage 5): saving a real handle via the UI resolves to a userId end-to-end.
- [ ] One commit.

## Notes

- Don't import `drizzle-orm` (rule enforced).
- Don't pull rettiwt-api into the web bundle (only the API uses it for resolution).
- The `useFieldArray` pattern is ergonomic for this case; resist the temptation to roll a custom array editor.
- Keep the visual style consistent with the existing Reddit row — the design is "operator UI", not polished public UI.
- Stage 5 (functional-verify) will run a Playwright VS-6 to confirm the UI round-trip.
