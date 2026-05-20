import { FlagEmbedding, EmbeddingModel } from "fastembed";
import type { CommandIRCandidate } from "./ir.js";
import type { CommandExtractor } from "./extractors.js";
import type { RouteResources } from "../router.js";
import { metadataBm25Documents, candidateFromMetadataDoc } from "./metadataBm25Extractor.js";

const EMBEDDING_THRESHOLD = Number(process.env.PIG_COMPILER_EMBEDDING_THRESHOLD ?? "0.72");
let modelPromise: Promise<FlagEmbedding> | null = null;

function enabled(): boolean {
  return process.env.PIG_ENABLE_EMBEDDING_EXTRACTOR === "1";
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, an = 0, bn = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]; an += a[i] * a[i]; bn += b[i] * b[i];
  }
  return an && bn ? dot / (Math.sqrt(an) * Math.sqrt(bn)) : 0;
}

async function model(): Promise<FlagEmbedding> {
  modelPromise ??= FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2, showDownloadProgress: false });
  return modelPromise;
}

async function embedOne(text: string): Promise<number[]> {
  const m = await model();
  for await (const batch of m.embed([text])) return Array.from(batch[0]);
  return [];
}

export const embeddingExtractor: CommandExtractor = {
  name: "metadata-embedding",
  async extract(text: string, resources: RouteResources): Promise<CommandIRCandidate[]> {
    if (!enabled()) return [];
    const docs = metadataBm25Documents(resources);
    if (docs.length === 0) return [];
    const query = await embedOne(text);
    const scored: CommandIRCandidate[] = [];
    for (const doc of docs) {
      const body = doc.fields.join("\n");
      const emb = await embedOne(body);
      const score = cosine(query, emb);
      if (score < EMBEDDING_THRESHOLD) continue;
      const candidate = candidateFromMetadataDoc(doc, Number(Math.min(0.91, score).toFixed(2)), [doc.skill, doc.intent ?? "metadata"]);
      if (candidate) scored.push({ ...candidate, extractor: this.name, reason: `embedding matched ${doc.skill}${doc.intent ? `:${doc.intent}` : ""}` });
    }
    return scored.sort((a, b) => b.ir.confidence - a.ir.confidence).slice(0, 5);
  },
};
