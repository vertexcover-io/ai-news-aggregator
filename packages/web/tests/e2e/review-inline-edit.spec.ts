import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { adminLogin, makeDbClient } from "./_infra";


interface SeededReview {
  readonly runId: string;
  readonly rawItemIds: readonly number[];
  readonly originalTitle: string;
  readonly editedTitle: string;
}


async function seedRawItem(
  client: Client,
  opts: {
    readonly externalId: string;
    readonly title: string;
  },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO raw_items
       (source_type, external_id, title, url, author, published_at, engagement, metadata)
     VALUES
       ('hn', $1, $2, $3, 'review-e2e', '2099-06-01T00:00:00Z'::timestamp,
        '{"points": 64, "commentCount": 9}'::jsonb, $4::jsonb)
     RETURNING id`,
    [
      opts.externalId,
      opts.title,
      `https://example.com/${opts.externalId}`,
      JSON.stringify({
        comments: [],
        recap: {
          title: opts.title,
          summary: "This story title will be edited inline.",
          bullets: ["Inline editing updates the review draft."],
          bottomLine: "The edited title should render publicly after save.",
        },
      }),
    ],
  );
  const row = result.rows[0];
  return row.id;
}

async function seedReviewArchive(): Promise<SeededReview> {
  const client = makeDbClient();
  await client.connect();
  try {
    const runId = randomUUID();
    const suffix = runId.slice(0, 8);
    const originalTitle = `Inline original title ${suffix}`;
    const editedTitle = `Inline edited title ${suffix}`;
    const rawItemId = await seedRawItem(client, {
      externalId: `review-inline-${suffix}`,
      title: originalTitle,
    });
    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, completed_at, started_at,
          source_types, digest_headline, digest_summary)
       VALUES
         ($1, 'completed', $2::jsonb, 1, false, '2099-06-02T00:00:00Z'::timestamp,
          '2099-06-01T23:59:00Z'::timestamp, '["hn"]'::jsonb,
          'Review inline digest', 'Review inline digest summary')`,
      [
        runId,
        JSON.stringify([
          { rawItemId, score: 0.99, rationale: "inline edit candidate" },
        ]),
      ],
    );
    return {
      runId,
      rawItemIds: [rawItemId],
      originalTitle,
      editedTitle,
    };
  } finally {
    await client.end();
  }
}

async function cleanupReviewArchive(seed: SeededReview | null): Promise<void> {
  if (seed === null) return;
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query("DELETE FROM run_archives WHERE id = $1", [seed.runId]);
    await client.query("DELETE FROM raw_items WHERE id = ANY($1::int[])", [
      seed.rawItemIds,
    ]);
  } finally {
    await client.end();
  }
}

test.describe("review inline edit e2e", () => {
  let seeded: SeededReview | null = null;

  test.beforeEach(async () => {
    seeded = await seedReviewArchive();
  });

  test.afterEach(async () => {
    await cleanupReviewArchive(seeded);
    seeded = null;
  });

  test("REQ-AR-8: inline-edited recap title renders in archive detail after save", async ({
    page,
  }) => {
    if (seeded === null) throw new Error("seed missing");
    await adminLogin(page);
    await page.goto(`/admin/review/${seeded.runId}`);

    await expect(page.getByText(seeded.originalTitle)).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: `${seeded.originalTitle} Edit` })
      .click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(seeded.editedTitle);
    await page.keyboard.press("Enter");

    await expect(page.getByText(seeded.editedTitle)).toBeVisible();
    await page
      .getByRole("button", { name: /save & publish/i })
      .click();

    await expect(page).toHaveURL(new RegExp(`/archive/${seeded.runId}$`));
    // The archive story heading appends a "↗" affordance to the link text, so
    // match on a substring rather than an exact accessible name.
    await expect(
      page.getByRole("heading", { name: seeded.editedTitle }),
    ).toBeVisible();
    await expect(page.getByText(seeded.originalTitle)).toHaveCount(0);
  });
});
