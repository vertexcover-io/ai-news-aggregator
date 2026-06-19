/**
 * createUserSubmission — canonical-URL dedupe, title fallback, and the
 * single tenant-stamped `manual` write. Tenant fencing itself lives in the
 * repo (covered by the e2e); here we verify the service builds the right
 * `manual` insert and reports `alreadyExisted` from the pre-upsert lookup.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createUserSubmission,
  hashUrl,
  type CreateSubmissionDeps,
  type SubmissionRawItemsRepo,
} from "@api/services/user-submissions.js";
import type { RawItemInsert } from "@newsletter/shared/db";

/** Test canonicalizer: drop the query string (stand-in for tracking-param strip). */
const stripQuery = (u: string): string => u.split("?")[0] ?? u;

interface Captured {
  repo: SubmissionRawItemsRepo;
  upserts: RawItemInsert[][];
  lookups: { sourceType: string; externalId: string }[];
}

function fakeRepo(preExisting = false): Captured {
  const upserts: RawItemInsert[][] = [];
  const lookups: { sourceType: string; externalId: string }[] = [];
  let row: { id: number; url: string; title: string } | null = preExisting
    ? { id: 7, url: "https://seed", title: "seed" }
    : null;
  const repo: SubmissionRawItemsRepo = {
    findBySourceAndExternalId: vi.fn((sourceType: string, externalId: string) => {
      lookups.push({ sourceType, externalId });
      return Promise.resolve(row);
    }),
    upsertItems: vi.fn((items: RawItemInsert[]) => {
      upserts.push(items);
      const i = items[0];
      if (i) row = { id: 42, url: i.url, title: i.title };
      return Promise.resolve();
    }),
  };
  return { repo, upserts, lookups };
}

function deps(
  cap: Captured,
  enrichUrl: CreateSubmissionDeps["enrichUrl"] = () => Promise.resolve({}),
): CreateSubmissionDeps {
  return { rawItemsRepo: cap.repo, canonicalizeUrl: stripQuery, enrichUrl };
}

describe("createUserSubmission", () => {
  it("writes one manual row stamped via the canonical externalId", async () => {
    const cap = fakeRepo();
    const res = await createUserSubmission(
      { url: "https://example.com/post", title: "My Title" },
      deps(cap),
    );

    expect(cap.upserts).toHaveLength(1);
    const insert = cap.upserts[0]?.[0];
    expect(insert?.sourceType).toBe("manual");
    expect(insert?.url).toBe("https://example.com/post");
    expect(insert?.title).toBe("My Title");
    // externalId is the hash of the CANONICAL url.
    expect(cap.lookups[0]?.externalId).toBe(
      hashUrl("https://example.com/post"),
    );
    expect(res).toMatchObject({ sourceType: "manual", alreadyExisted: false });
  });

  it("dedupes tracking-param variants to the same externalId", async () => {
    const a = fakeRepo();
    await createUserSubmission({ url: "https://x.com/p" }, deps(a));
    const b = fakeRepo();
    await createUserSubmission({ url: "https://x.com/p?utm_source=ext" }, deps(b));
    expect(a.lookups[0]?.externalId).toBe(b.lookups[0]?.externalId);
  });

  it("reports alreadyExisted when the row pre-exists for this tenant", async () => {
    const cap = fakeRepo(true);
    const res = await createUserSubmission({ url: "https://x.com/p" }, deps(cap));
    expect(res.alreadyExisted).toBe(true);
  });

  it("falls back to enriched title then the URL when no title is given", async () => {
    const enriched = fakeRepo();
    await createUserSubmission(
      { url: "https://x.com/p" },
      deps(enriched, () => Promise.resolve({ title: "Enriched" })),
    );
    expect(enriched.upserts[0]?.[0]?.title).toBe("Enriched");

    const bare = fakeRepo();
    await createUserSubmission(
      { url: "https://x.com/p" },
      deps(bare, () => Promise.resolve({})),
    );
    expect(bare.upserts[0]?.[0]?.title).toBe("https://x.com/p");
  });

  it("survives enrichment failure (EDGE-004) and still writes the row", async () => {
    const cap = fakeRepo();
    const res = await createUserSubmission(
      { url: "https://x.com/p" },
      deps(cap, () => Promise.reject(new Error("enrich boom"))),
    );
    expect(cap.upserts).toHaveLength(1);
    expect(res.title).toBe("https://x.com/p");
  });
});
