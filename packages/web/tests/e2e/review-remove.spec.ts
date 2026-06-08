import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";


interface SeededReview {
  readonly runId: string;
  readonly rawItemIds: readonly number[];
  readonly removedTitle: string;
  readonly keptTitle: string;
}

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function seedRawItem(
  client: Client,
  opts: {
    readonly externalId: string;
    readonly title: string;
    readonly summary: string;
  },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO raw_items
       (source_type, external_id, title, url, author, published_at, engagement, metadata)
     VALUES
       ('hn', $1, $2, $3, 'review-e2e', '2099-05-01T00:00:00Z'::timestamp,
        '{"points": 42, "commentCount": 7}'::jsonb, $4::jsonb)
     RETURNING id`,
    [
      opts.externalId,
      opts.title,
      `https://example.com/${opts.externalId}`,
      JSON.stringify({
        comments: [],
        recap: {
          title: opts.title,
          summary: opts.summary,
          bullets: ["The first useful detail.", "The second useful detail."],
          bottomLine: "This item should remain observable after save.",
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
    const removedTitle = `Remove flow title ${suffix}`;
    const keptTitle = `Kept flow title ${suffix}`;
    const removedId = await seedRawItem(client, {
      externalId: `review-remove-${suffix}-removed`,
      title: removedTitle,
      summary: "This story should be removed before publishing.",
    });
    const keptId = await seedRawItem(client, {
      externalId: `review-remove-${suffix}-kept`,
      title: keptTitle,
      summary: "This story should survive the review save.",
    });
    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, completed_at, started_at,
          source_types, digest_headline, digest_summary)
       VALUES
         ($1, 'completed', $2::jsonb, 2, false, '2099-05-02T00:00:00Z'::timestamp,
          '2099-05-01T23:59:00Z'::timestamp, '["hn"]'::jsonb,
          'Review remove digest', 'Review remove digest summary')`,
      [
        runId,
        JSON.stringify([
          { rawItemId: removedId, score: 0.99, rationale: "remove candidate" },
          { rawItemId: keptId, score: 0.88, rationale: "keep candidate" },
        ]),
      ],
    );
    return {
      runId,
      rawItemIds: [removedId, keptId],
      removedTitle,
      keptTitle,
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

test.describe("review remove e2e", () => {
  let seeded: SeededReview | null = null;

  test.beforeEach(async () => {
    seeded = await seedReviewArchive();
  });

  test.afterEach(async () => {
    await cleanupReviewArchive(seeded);
    seeded = null;
  });

  test("REQ-AR-7: removing an item and saving excludes it from the archive", async ({
    page,
  }) => {
    if (seeded === null) throw new Error("seed missing");
    await adminLogin(page);
    await page.goto(`/admin/review/${seeded.runId}`);

    await expect(page.getByText(seeded.removedTitle)).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: `Remove ${seeded.removedTitle}` })
      .click();

    await expect(page.getByText(seeded.keptTitle)).toBeVisible();
    await page
      .getByRole("button", { name: /save & publish/i })
      .click();

    // Removing an item drifts the ranked list from the digest signature, so the
    // SaveBar asks to confirm saving without regenerating the digest copy.
    await page.getByRole("button", { name: /save anyway/i }).click();

    await expect(page).toHaveURL(new RegExp(`/archive/${seeded.runId}$`));
    // The archive story heading appends a "↗" affordance to the link text, so
    // match on a substring rather than an exact accessible name.
    await expect(
      page.getByRole("heading", { name: seeded.keptTitle }),
    ).toBeVisible();
    await expect(page.getByText(seeded.removedTitle)).toHaveCount(0);
  });
});
