import type { RouteResources } from "../router.js";
import type { CommandIRCandidate } from "./ir.js";

/** Replaceable boundary for the eventual real extractor. */
export interface CommandExtractor {
  readonly name: string;
  extract(text: string, resources: RouteResources): CommandIRCandidate[];
}

export function runExtractorStack(text: string, resources: RouteResources, extractors: CommandExtractor[]): CommandIRCandidate[] {
  const candidates: CommandIRCandidate[] = [];
  for (const extractor of extractors) {
    const produced = extractor.extract(text, resources);
    candidates.push(...produced.map((candidate) => ({
      ...candidate,
      extractor: candidate.extractor || extractor.name,
    })));
  }
  return candidates.sort((a, b) => b.ir.confidence - a.ir.confidence);
}
