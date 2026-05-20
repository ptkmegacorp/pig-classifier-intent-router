import type { RouteResources, RoutingFamily, RoutingIntent } from "../router.js";
import type { ChatIR, CommandIR, CommandIRCandidate, ImageCommandIR, ScreenCommandIR, WeatherCommandIR } from "./ir.js";
import type { CommandExtractor } from "./extractors.js";

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "use", "what", "this", "that", "today"]);
const BM25_THRESHOLD = Number(process.env.PIG_COMPILER_BM25_THRESHOLD ?? "0.48");

type CommandIRTemplate = Omit<ChatIR, "confidence"> | Omit<ScreenCommandIR, "confidence"> | Omit<ImageCommandIR, "confidence"> | Omit<WeatherCommandIR, "confidence">;

export interface MetadataDoc {
  skill: string;
  intent: RoutingIntent | null;
  family: RoutingFamily | null;
  fields: string[];
  negativePhrases: string[];
  tokens: string[];
  tokenCounts: Map<string, number>;
  length: number;
  ir: CommandIRTemplate;
}

function tokenizeAll(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function normalizeForPhrase(text: string): string { return ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `; }
function phraseMatches(text: string, phrase: string): boolean { return normalizeForPhrase(text).includes(normalizeForPhrase(phrase)); }
function countTokens(tokens: string[]): Map<string, number> { const counts = new Map<string, number>(); for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1); return counts; }
function withConfidence(ir: CommandIRTemplate, confidence: number): CommandIR { return { ...ir, confidence } as CommandIR; }

export function metadataBm25Documents(resources: RouteResources): MetadataDoc[] {
  const docs: MetadataDoc[] = [];
  for (const skill of resources.catalog) {
    for (const intent of skill.compilerIntents) {
      const fields = [intent.id.replace(/[_-]/g, " "), ...intent.examples, ...intent.keywords];
      const tokens = fields.flatMap(tokenizeAll);
      docs.push({
        skill: skill.name,
        intent: intent.id,
        family: skill.family,
        fields,
        negativePhrases: intent.negativeExamples,
        tokens,
        tokenCounts: countTokens(tokens),
        length: Math.max(1, tokens.length),
        ir: intent.ir as CommandIRTemplate,
      });
    }
  }
  return docs;
}

function bm25Score(queryTokens: string[], doc: MetadataDoc, docs: MetadataDoc[], avgDocLength: number): number {
  const k1 = 1.2, b = 0.75;
  let score = 0;
  for (const token of unique(queryTokens)) {
    const tf = doc.tokenCounts.get(token) ?? 0;
    if (tf === 0) continue;
    const docsWithToken = docs.filter((candidate) => candidate.tokenCounts.has(token)).length;
    const idf = Math.log(1 + (docs.length - docsWithToken + 0.5) / (docsWithToken + 0.5));
    const denominator = tf + k1 * (1 - b + b * (doc.length / avgDocLength));
    score += idf * ((tf * (k1 + 1)) / denominator);
  }
  return score;
}

export function candidateFromMetadataDoc(doc: MetadataDoc, confidence: number, matchedTerms: string[]): CommandIRCandidate | null {
  return {
    ir: withConfidence(doc.ir, confidence),
    extractor: "metadata-bm25",
    matchedTerms,
    reason: `metadata BM25 matched ${doc.skill}${doc.intent ? `:${doc.intent}` : ""}`,
  };
}

export const metadataBm25Extractor: CommandExtractor = {
  name: "metadata-bm25",
  extract(text: string, resources: RouteResources): CommandIRCandidate[] {
    const docs = metadataBm25Documents(resources);
    const queryTokens = tokenizeAll(text);
    if (docs.length === 0 || queryTokens.length === 0) return [];
    const avgDocLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
    return docs.map((doc) => {
      const negativeMatches = doc.negativePhrases.filter((phrase) => phraseMatches(text, phrase));
      if (negativeMatches.length > 0) return null;
      const phraseMatchesForDoc = doc.fields.filter((field) => field.includes(" ") && phraseMatches(text, field));
      const rawScore = bm25Score(queryTokens, doc, docs, avgDocLength) + phraseMatchesForDoc.length * 1.5;
      const confidence = Math.min(0.92, Number((rawScore / (rawScore + 1.7)).toFixed(2)));
      if (confidence < BM25_THRESHOLD) return null;
      const queryTokenSet = new Set(queryTokens);
      const matchedTerms = unique([...phraseMatchesForDoc, ...doc.tokens.filter((token) => queryTokenSet.has(token))]);
      return candidateFromMetadataDoc(doc, confidence, matchedTerms);
    }).filter((candidate): candidate is CommandIRCandidate => Boolean(candidate)).sort((a, b) => b.ir.confidence - a.ir.confidence).slice(0, 5);
  },
};
