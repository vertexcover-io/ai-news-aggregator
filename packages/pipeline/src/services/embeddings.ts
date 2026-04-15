const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite";
const DIMENSIONS = 512;

interface VoyageEmbeddingDatum {
  embedding: number[];
  index: number;
}

interface VoyageResponse {
  data: VoyageEmbeddingDatum[];
}

interface EmbedBatchOptions {
  inputType?: "query" | "document";
  signal?: AbortSignal;
}

export async function embedBatch(
  inputs: string[],
  options?: EmbedBatchOptions,
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    input: inputs,
    model: MODEL,
    output_dimension: DIMENSIONS,
  };
  if (options?.inputType) {
    body.input_type = options.inputType;
  }

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `voyage embeddings request failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as VoyageResponse;
  if (!Array.isArray(json.data)) {
    throw new Error(`Voyage API error: ${JSON.stringify(json)}`);
  }
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
