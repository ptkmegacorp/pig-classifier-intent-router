import type { CommandIRCandidate } from "./ir.js";
import type { CommandExtractor } from "./extractors.js";
import type { RouteResources } from "../router.js";
import { metadataBm25Documents, candidateFromMetadataDoc, type MetadataDoc } from "./metadataBm25Extractor.js";
import { getEmbeddingsProvider } from "./embeddingsProvider.js";

const EMBEDDING_THRESHOLD = Number(process.env.PIG_COMPILER_EMBEDDING_THRESHOLD ?? "0.72");
const docCache = new WeakMap<RouteResources, Promise<Array<{ doc: MetadataDoc; embedding: number[] }>>>();

function enabled(): boolean { return process.env.PIG_ENABLE_EMBEDDING_EXTRACTOR === "1"; }

function cosine(a: number[], b: number[]): number {
  let dot = 0, an = 0, bn = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; an += a[i] * a[i]; bn += b[i] * b[i]; }
  return an && bn ? dot / (Math.sqrt(an) * Math.sqrt(bn)) : 0;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  return (await getEmbeddingsProvider()).embed(texts);
}

function cachedDocs(resources: RouteResources): Promise<Array<{ doc: MetadataDoc; embedding: number[] }>> {
  let cached = docCache.get(resources);
  if (!cached) {
    const docs = metadataBm25Documents(resources);
    cached = embedTexts(docs.map((doc) => doc.fields.join("\n"))).then((embeddings) => docs.map((doc, index) => ({ doc, embedding: embeddings[index] ?? [] })));
    docCache.set(resources, cached);
  }
  return cached;
}

export const embeddingExtractor: CommandExtractor = {
  name: "metadata-embedding",
  async extract(text: string, resources: RouteResources): Promise<CommandIRCandidate[]> {
    if (!enabled()) return [];
    const docs = await cachedDocs(resources);
    if (docs.length === 0) return [];
    const [query] = await embedTexts([text]);
    const scored: CommandIRCandidate[] = [];
    for (const { doc, embedding } of docs) {
      const score = cosine(query ?? [], embedding);
      if (score < EMBEDDING_THRESHOLD) continue;
      const candidate = candidateFromMetadataDoc(doc, Number(Math.min(0.91, score).toFixed(2)), [doc.skill, doc.intent ?? "metadata"]);
      if (candidate) scored.push({ ...candidate, extractor: this.name, reason: `embedding matched ${doc.skill}${doc.intent ? `:${doc.intent}` : ""}` });
    }
    return scored.sort((a, b) => b.ir.confidence - a.ir.confidence).slice(0, 5);
  },
};
