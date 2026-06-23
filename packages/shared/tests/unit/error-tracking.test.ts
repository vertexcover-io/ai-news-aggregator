import { describe, it, expect } from "vitest";
import { classifyError, classifyCategory, fixabilityFor } from "@shared/errors/classify.js";
import { computeFingerprint, normalizeMessage, topAppFrame } from "@shared/errors/fingerprint.js";
import { redactSecrets } from "@shared/errors/redact.js";
import { createIncidentService } from "@shared/errors/incident-service.js";
import type {
  IncidentRepo,
  UpsertIncidentInput,
  UpsertIncidentResult,
} from "@shared/errors/incident-service.js";
import type { GithubClient } from "@shared/github/client.js";
import type { ErrorIncidentRecord } from "@shared/errors/types.js";

/** Build an error whose stack points into one of our packages (→ code-bug). */
function appError(message: string): Error {
  const e = new Error(message);
  e.stack = `Error: ${message}\n    at fn (/app/packages/pipeline/src/foo.ts:10:5)`;
  return e;
}

/** Build an error whose only frames are node_modules (→ no app frame). */
function vendorError(message: string): Error {
  const e = new Error(message);
  e.stack = `Error: ${message}\n    at x (/app/node_modules/whatever/index.js:1:1)`;
  return e;
}

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Build a ZodError-shaped error whose stack points into our packages (→ schema/agent). */
function schemaError(message: string): Error {
  const e = Object.assign(new Error(message), { name: "ZodError" });
  e.stack = `ZodError: ${message}\n    at parse (/app/packages/pipeline/src/collectors/hn.ts:42:7)`;
  return e;
}

describe("classifyError", () => {
  it("maps the priority chain to categories", () => {
    expect(classifyCategory(statusError("nope", 401))).toBe("auth");
    expect(classifyCategory(statusError("slow down", 429))).toBe("rate-limit");
    expect(classifyCategory(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      "network-timeout",
    );
    expect(classifyCategory(vendorError("ECONNREFUSED 1.2.3.4"))).toBe("blocked");
    expect(classifyCategory(Object.assign(new Error("bad"), { name: "ZodError" }))).toBe(
      "schema",
    );
  });

  it("classifies an unmatched error in our stack as code-bug, vendor as unknown", () => {
    expect(classifyCategory(appError("cannot read x of undefined"))).toBe("code-bug");
    expect(classifyCategory(vendorError("weird internal"))).toBe("unknown");
  });

  it("derives fixability lanes per the routing table", () => {
    expect(fixabilityFor("schema")).toBe("agent");
    expect(fixabilityFor("code-bug")).toBe("agent");
    expect(fixabilityFor("auth")).toBe("human");
    expect(fixabilityFor("unknown")).toBe("human");
    expect(fixabilityFor("rate-limit")).toBe("notify");
    expect(fixabilityFor("network-timeout")).toBe("notify");
    expect(fixabilityFor("blocked")).toBe("notify");
  });

  it("returns the {category, fixability} pair", () => {
    expect(classifyError(statusError("nope", 403))).toEqual({
      category: "auth",
      fixability: "human",
    });
  });
});

describe("fingerprint", () => {
  it("normalizes volatile tokens out of the message", () => {
    expect(normalizeMessage("run 12345 at https://x.io/a failed")).toBe(
      "run <n> at <url> failed",
    );
    expect(normalizeMessage("id 550e8400-e29b-41d4-a716-446655440000 bad")).toBe(
      "id <uuid> bad",
    );
  });

  it("finds the first app frame, ignoring node_modules", () => {
    expect(topAppFrame(appError("x").stack)).toBe("/packages/pipeline/src/foo.ts");
    expect(topAppFrame(vendorError("x").stack)).toBeUndefined();
    expect(topAppFrame(undefined)).toBeUndefined();
  });

  it("is stable across occurrences but varies by category/source", () => {
    const a = computeFingerprint({ category: "schema", source: "hn", message: "bad item 1", stack: undefined });
    const b = computeFingerprint({ category: "schema", source: "hn", message: "bad item 9999", stack: undefined });
    const c = computeFingerprint({ category: "code-bug", source: "hn", message: "bad item 1", stack: undefined });
    expect(a).toBe(b); // ids normalized away → same bug
    expect(a).not.toBe(c); // different category → different fingerprint
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("redactSecrets", () => {
  it("strips known secret shapes", () => {
    expect(redactSecrets("Authorization: Bearer abc123def456")).toContain("<redacted>");
    expect(redactSecrets("key sk-ABCDEF0123456789")).toContain("<redacted>");
    expect(redactSecrets("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123")).toContain("<redacted>");
    expect(redactSecrets("api_key=supersecretvalue123")).toBe("api_key=<redacted>");
    expect(redactSecrets("jwt eyJhbGci.eyJzdWIi.SflKxwRJ")).toContain("<redacted>");
  });

  it("leaves benign text untouched", () => {
    expect(redactSecrets("collector hn returned 0 items")).toBe("collector hn returned 0 items");
  });
});

interface StoredRow extends ErrorIncidentRecord {
  context: unknown;
}

/** In-memory IncidentRepo mirroring the real dedup semantics. */
function fakeRepo(): IncidentRepo & { rows: Map<string, StoredRow> } {
  const rows = new Map<string, StoredRow>();
  return {
    rows,
    upsertByFingerprint(input: UpsertIncidentInput): Promise<UpsertIncidentResult> {
      const existing = rows.get(input.fingerprint);
      if (existing === undefined) {
        const row: StoredRow = {
          fingerprint: input.fingerprint,
          category: input.category,
          fixability: input.fixability,
          sourcePackage: input.sourcePackage,
          status: "open",
          occurrenceCount: 1,
          githubRef: null,
          context: input.context,
        };
        rows.set(input.fingerprint, row);
        return Promise.resolve({ incident: { ...row }, isNew: true });
      }
      const reopen = existing.status === "resolved";
      existing.occurrenceCount = Number(existing.occurrenceCount) + 1;
      if (reopen) existing.status = "open";
      return Promise.resolve({ incident: { ...existing }, isNew: reopen });
    },
    markStatus(fingerprint, status, githubRef): Promise<void> {
      const row = rows.get(fingerprint);
      if (row !== undefined) {
        row.status = status;
        if (githubRef !== undefined) row.githubRef = githubRef;
      }
      return Promise.resolve();
    },
  };
}

interface DispatchCall {
  eventType: string;
  clientPayload: Record<string, unknown>;
}

function fakeGithub(): GithubClient & {
  issues: { title: string; labels?: string[] }[];
  dispatchCalls: DispatchCall[];
} {
  const issues: { title: string; labels?: string[] }[] = [];
  const dispatchCalls: DispatchCall[] = [];
  return {
    issues,
    dispatchCalls,
    createIssue(input) {
      issues.push({ title: input.title, labels: input.labels });
      return Promise.resolve({
        url: `https://gh/issues/${String(issues.length)}`,
        number: issues.length,
      });
    },
    dispatch(input) {
      dispatchCalls.push({ eventType: input.eventType, clientPayload: input.clientPayload });
      return Promise.resolve(true);
    },
  };
}

function fakeSlack(): { calls: unknown[]; fetchFn: typeof fetch } {
  const calls: unknown[] = [];
  const fetchFn = ((_url: string, init?: { body?: string }) => {
    calls.push(init?.body !== undefined ? JSON.parse(init.body) : null);
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("IncidentService.record", () => {
  const baseDeps = (repo: IncidentRepo, slack: ReturnType<typeof fakeSlack>, github: GithubClient) =>
    ({
      repo,
      enabled: true,
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/x",
      github,
      fetchFn: slack.fetchFn,
      escalationThreshold: 3,
    });

  it("new code-bug → one Slack ping + one agent-fixable issue; repeat is silent", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService(baseDeps(repo, slack, github));

    await svc.record({ err: appError("boom"), sourcePackage: "pipeline", source: "processing:run-process" });
    await svc.record({ err: appError("boom"), sourcePackage: "pipeline", source: "processing:run-process" });

    expect(slack.calls).toHaveLength(1);
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.labels).toContain("agent-fixable");
    const row = [...repo.rows.values()][0];
    expect(row?.occurrenceCount).toBe(2);
  });

  it("auth error opens a needs-human issue", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService(baseDeps(repo, slack, github));

    await svc.record({ err: statusError("401 nope", 401), sourcePackage: "api", source: "/api/runs" });

    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.labels).toContain("needs-human");
  });

  it("notify-lane incident pings Slack once on first sight, escalates to an issue at the threshold", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService(baseDeps(repo, slack, github));

    const rateLimited = (): Error => statusError("429 slow down", 429);
    await svc.record({ err: rateLimited(), sourcePackage: "pipeline", source: "collection:hn" }); // occ 1, isNew → Slack, no issue
    await svc.record({ err: rateLimited(), sourcePackage: "pipeline", source: "collection:hn" }); // occ 2, silent
    await svc.record({ err: rateLimited(), sourcePackage: "pipeline", source: "collection:hn" }); // occ 3, escalates

    expect(github.issues).toHaveLength(1); // only at escalation
    expect(github.issues[0]?.labels).toContain("needs-human");
    expect(slack.calls).toHaveLength(2); // first sight + escalation
  });

  it("is a no-op when disabled", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService({ ...baseDeps(repo, slack, github), enabled: false });

    await svc.record({ err: appError("boom"), sourcePackage: "pipeline", source: "x" });

    expect(slack.calls).toHaveLength(0);
    expect(github.issues).toHaveLength(0);
    expect(repo.rows.size).toBe(0);
  });

  it("agent + schema + autofix enabled → dispatches once with a redacted payload + the issue number", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService({
      ...baseDeps(repo, slack, github),
      autofixEnabled: true,
    });

    await svc.record({
      err: schemaError("invalid_type expected string, got Bearer abc123def456"),
      sourcePackage: "pipeline",
      source: "collection:hn",
    });

    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.labels).toContain("agent-fixable");
    expect(slack.calls).toHaveLength(1);
    expect(github.dispatchCalls).toHaveLength(1);
    const call = github.dispatchCalls[0];
    expect(call?.eventType).toBe("error-autofix");
    expect(call?.clientPayload.category).toBe("schema");
    expect(call?.clientPayload.issueNumber).toBe(1);
    // redacted before leaving the process
    expect(JSON.stringify(call?.clientPayload)).not.toContain("abc123def456");
  });

  it("repeat schema fingerprint dispatches only once", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService({
      ...baseDeps(repo, slack, github),
      autofixEnabled: true,
    });

    await svc.record({ err: schemaError("bad shape"), sourcePackage: "pipeline", source: "collection:hn" });
    await svc.record({ err: schemaError("bad shape"), sourcePackage: "pipeline", source: "collection:hn" });

    expect(github.dispatchCalls).toHaveLength(1);
    expect(github.issues).toHaveLength(1);
  });

  it("agent + code-bug (not in autofix categories) opens an issue but does not dispatch", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService({
      ...baseDeps(repo, slack, github),
      autofixEnabled: true,
    });

    await svc.record({ err: appError("cannot read x of undefined"), sourcePackage: "pipeline", source: "x" });

    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.labels).toContain("agent-fixable");
    expect(github.dispatchCalls).toHaveLength(0);
  });

  it("agent + schema but autofix disabled opens an issue without dispatching", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService(baseDeps(repo, slack, github)); // autofixEnabled defaults false

    await svc.record({ err: schemaError("bad shape"), sourcePackage: "pipeline", source: "collection:hn" });

    expect(github.issues).toHaveLength(1);
    expect(github.dispatchCalls).toHaveLength(0);
  });

  it("redacts secrets before they reach Slack or the incident row", async () => {
    const repo = fakeRepo();
    const slack = fakeSlack();
    const github = fakeGithub();
    const svc = createIncidentService(baseDeps(repo, slack, github));

    await svc.record({
      err: appError("failed with Bearer abc123def456 token"),
      sourcePackage: "pipeline",
      source: "x",
    });

    const row = [...repo.rows.values()][0];
    expect(JSON.stringify(row?.context)).not.toContain("abc123def456");
    expect(JSON.stringify(slack.calls)).not.toContain("abc123def456");
  });
});
