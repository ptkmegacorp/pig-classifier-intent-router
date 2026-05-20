import type { RouteResources } from "../router.js";
import type { CommandExtractor } from "./extractors.js";
import type { CommandIRCandidate } from "./ir.js";

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function has(text: string, terms: string[]): string[] {
  const n = normalize(text);
  return terms.filter((term) => n.includes(normalize(term)));
}

/**
 * Temporary rule extractor. It is intentionally small and replaceable: its job
 * is to exercise the compiler stages, not to be the final classifier.
 */
export function extractDefaultCommandIR(text: string): CommandIRCandidate[] {
  const candidates: CommandIRCandidate[] = [];
  const lower = normalize(text);

  const weatherTerms = has(text, ["weather", "forecast", "temperature", "temp", "rain", "raining", "snow", "wind", "windy", "storm", "radar", "humidity", "jacket", "umbrella", "outside"]);
  if (weatherTerms.length > 0) {
    candidates.push({
      ir: {
        kind: "command",
        domain: "weather",
        action: "lookup",
        object: "weather",
        target: "current",
        time: lower.includes(" tomorrow ") ? "tomorrow" : lower.includes(" tonight ") ? "tonight" : "today",
        confidence: 0.9,
      },
      extractor: "default-rules-v0",
      matchedTerms: weatherTerms,
      reason: "matched explicit weather concept",
    });
  }

  const screenshotTerms = has(text, ["screenshot", "screen shot", "screen capture"]);
  const screenTerms = has(text, ["screen", "display", "desktop"]);
  const inspectTerms = has(text, ["look at", "describe", "inspect", "read", "what is on", "what's on", "what is in", "what's in", "view"]);
  const displayTerms = has(text, ["open", "show me", "show", "display", "pull up", "bring up"]);
  const captureTerms = has(text, ["take", "capture", "grab", "save", "snap"]);

  if (screenshotTerms.length > 0 || (screenTerms.length > 0 && (captureTerms.length > 0 || inspectTerms.length > 0))) {
    const object = screenshotTerms.length > 0 ? "screenshot" : "screen";
    if (inspectTerms.length > 0) {
      candidates.push({
        ir: { kind: "command", domain: "screen", action: "inspect", object, target: object === "screen" ? "current" : "last", intent: "visual_inspect", confidence: 0.88 },
        extractor: "default-rules-v0",
        matchedTerms: [...inspectTerms, ...screenshotTerms, ...screenTerms],
        reason: "matched screen visual inspection phrase",
      });
    } else if (displayTerms.length > 0 && screenshotTerms.length > 0) {
      candidates.push({
        ir: { kind: "command", domain: "screen", action: displayTerms.includes("open") ? "open" : "show", object: "screenshot", target: "last", intent: "display_to_user", confidence: 0.9 },
        extractor: "default-rules-v0",
        matchedTerms: [...displayTerms, ...screenshotTerms],
        reason: "matched display latest screenshot phrase",
      });
    } else if (captureTerms.length > 0) {
      candidates.push({
        ir: { kind: "command", domain: "screen", action: "capture", object: "screenshot", target: "current", confidence: 0.9 },
        extractor: "default-rules-v0",
        matchedTerms: [...captureTerms, ...screenshotTerms, ...screenTerms],
        reason: "matched screenshot capture phrase",
      });
    }
  }

  const photoTerms = has(text, ["photo", "picture", "camera"]);
  if (photoTerms.length > 0) {
    if (inspectTerms.length > 0) {
      candidates.push({
        ir: { kind: "command", domain: "image", action: "inspect", object: "photo", target: "current", intent: "visual_inspect", confidence: 0.88 },
        extractor: "default-rules-v0",
        matchedTerms: [...inspectTerms, ...photoTerms],
        reason: "matched photo visual inspection phrase",
      });
    } else if (captureTerms.length > 0) {
      candidates.push({
        ir: { kind: "command", domain: "image", action: "capture", object: "photo", target: "current", confidence: 0.9 },
        extractor: "default-rules-v0",
        matchedTerms: [...captureTerms, ...photoTerms],
        reason: "matched photo capture phrase",
      });
    }
  }

  if (candidates.length === 0) {
    const phatic = has(text, ["how are you", "hello", "hi", "thanks", "thank you"]);
    candidates.push({
      ir: { kind: "chat", reason: phatic.length > 0 ? "phatic" : "no_command", confidence: phatic.length > 0 ? 0.85 : 0.5 },
      extractor: "default-rules-v0",
      matchedTerms: phatic,
      reason: phatic.length > 0 ? "matched phatic chat phrase" : "no deterministic command recognized",
    });
  }

  return candidates.sort((a, b) => b.ir.confidence - a.ir.confidence);
}

export const defaultCommandExtractor: CommandExtractor = {
  name: "default-rules-v0",
  extract(text: string, _resources: RouteResources): CommandIRCandidate[] {
    return extractDefaultCommandIR(text);
  },
};
