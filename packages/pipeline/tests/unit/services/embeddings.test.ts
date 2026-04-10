import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  embedBatch,
  cosineSimilarity,
} from "@pipeline/services/embeddings.js";

interface VoyageEmbeddingDatum {
  embedding: number[];
  index: number;
}

interface VoyageResponseBody {
  data: VoyageEmbeddingDatum[];
}

function jsonResponse(body: VoyageResponseBody, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

describe("embedBatch (REQ-009, REQ-025a, EDGE-012)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns [] and does not call fetch when inputs is empty", async () => {
    const result = await embedBatch([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when VOYAGE_API_KEY is not set", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "");
    await expect(embedBatch(["hello"])).rejects.toThrow(
      /VOYAGE_API_KEY is not set/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends POST with Bearer auth, model voyage-3.5-lite, and output_dimension 512 (REQ-025a)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ embedding: [0.1, 0.2], index: 0 }],
      }),
    );

    await embedBatch(["hello world"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-key");
    expect(headers?.["Content-Type"]).toBe("application/json");

    const bodyText = typeof init?.body === "string" ? init.body : "";
    const parsed = JSON.parse(bodyText) as {
      input: string[];
      model: string;
      output_dimension: number;
      input_type?: string;
    };
    expect(parsed.model).toBe("voyage-3.5-lite");
    expect(parsed.output_dimension).toBe(512);
    expect(parsed.input).toEqual(["hello world"]);
    expect(parsed.input_type).toBeUndefined();
  });

  it("includes input_type when options.inputType is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ embedding: [0.1], index: 0 }],
      }),
    );

    await embedBatch(["query text"], { inputType: "query" });

    const [, init] = fetchMock.mock.calls[0];
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const parsed = JSON.parse(bodyText) as { input_type?: string };
    expect(parsed.input_type).toBe("query");
  });

  it("reorders response embeddings by index to match input order", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { embedding: [3, 3, 3], index: 2 },
          { embedding: [1, 1, 1], index: 0 },
          { embedding: [2, 2, 2], index: 1 },
        ],
      }),
    );

    const result = await embedBatch(["a", "b", "c"]);

    expect(result).toEqual([
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ]);
  });

  it("throws an informative error on HTTP 500 (EDGE-012)", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(500, "internal server error"),
    );

    await expect(embedBatch(["hello"])).rejects.toThrow(
      /voyage embeddings request failed: 500/,
    );
  });

  it("throws on HTTP 429 without retrying", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429, "rate limited"));

    await expect(embedBatch(["hello"])).rejects.toThrow(
      /voyage embeddings request failed: 429/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns 0 when one input is a zero vector (guards NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
  });

  it("returns ~0.707 for a 45-degree angle", () => {
    const sim = cosineSimilarity([1, 0], [Math.SQRT1_2, Math.SQRT1_2]);
    expect(sim).toBeCloseTo(Math.SQRT1_2, 10);
  });
});
