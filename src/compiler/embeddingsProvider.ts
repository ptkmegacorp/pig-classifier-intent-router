export interface EmbeddingsProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

let providerPromise: Promise<EmbeddingsProvider> | null = null;
let providerFactory: (() => Promise<EmbeddingsProvider>) | null = null;

export function setEmbeddingsProviderFactory(factory: () => Promise<EmbeddingsProvider>): void {
  providerFactory = factory;
  providerPromise = null;
}

export async function getEmbeddingsProvider(): Promise<EmbeddingsProvider> {
  providerPromise ??= (providerFactory ?? createTransformersEmbeddingsProvider)();
  return providerPromise;
}

function meanPool(output: any): number[][] {
  if (Array.isArray(output)) return output as number[][];
  if (output?.tolist) {
    const value = output.tolist();
    if (Array.isArray(value?.[0])) return value;
  }
  if (output?.data && output?.dims?.length === 2) {
    const [rows, cols] = output.dims;
    const out: number[][] = [];
    for (let r = 0; r < rows; r++) out.push(Array.from(output.data.slice(r * cols, (r + 1) * cols)));
    return out;
  }
  throw new Error("Unsupported embedding output shape from transformers pipeline");
}

function normalizeRows(rows: number[][]): number[][] {
  return rows.map((row) => {
    const norm = Math.sqrt(row.reduce((sum, v) => sum + v * v, 0));
    return norm ? row.map((v) => v / norm) : row;
  });
}

export async function createTransformersEmbeddingsProvider(): Promise<EmbeddingsProvider> {
  // Lazy import: do not load any embedding runtime until semantic recall is enabled.
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = process.env.PIG_EMBEDDINGS_ALLOW_REMOTE === "1";
  const model = process.env.PIG_EMBEDDINGS_MODEL ?? "Xenova/all-MiniLM-L6-v2";
  const extractor = await pipeline("feature-extraction", model, { dtype: "fp32" });
  return {
    name: `transformers:${model}`,
    async embed(texts: string[]): Promise<number[][]> {
      const result = await extractor(texts, { pooling: "mean", normalize: true });
      return normalizeRows(meanPool(result));
    },
  };
}
