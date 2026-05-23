import type { DirectExecAction, RouteResources } from "../router.js";
import { defaultCommandExtractor } from "./defaultExtractor.js";
import { runExtractorStack, type CommandExtractor } from "./extractors.js";
import { metadataBm25Extractor } from "./metadataBm25Extractor.js";
import { embeddingExtractor } from "./embeddingExtractor.js";
import type { CommandCompilerDecision, CommandCompilerTrace, CommandIRCandidate } from "./ir.js";
import { lowerCommand } from "./lower.js";
import { checkCommandPreconditions } from "./preconditions.js";
import { resolveCommandIR } from "./resolve.js";
import { getPigCommandState } from "./state.js";
import { typecheckCommandIR } from "./typecheck.js";

function emptyTrace(extractors: CommandExtractor[], candidates: CommandIRCandidate[] = []): CommandCompilerTrace {
  return { enabled: true, extractors: extractors.map((extractor) => extractor.name), state: null, candidates, selectedIR: null, typecheck: null, resolved: null, preconditions: null, lowered: null, fallbackReason: null };
}

function actionStillEligible(candidate: NonNullable<ReturnType<typeof lowerCommand>>["directExec"], actions: DirectExecAction[]): boolean {
  if (!candidate) return true;
  return actions.some((action) => action.id === candidate.actionId && action.skill === candidate.skill);
}

export const DEFAULT_EXTRACTOR_STACK: CommandExtractor[] = [defaultCommandExtractor, metadataBm25Extractor, embeddingExtractor];

export async function compileVoiceCommand(text: string, resources: RouteResources, extractors: CommandExtractor[] = DEFAULT_EXTRACTOR_STACK): Promise<CommandCompilerDecision> {
  const state = getPigCommandState();
  const candidates = await runExtractorStack(text, resources, extractors);
  const trace = emptyTrace(extractors, candidates);
  trace.state = state;
  const selected = candidates[0]?.ir ?? null;
  trace.selectedIR = selected;

  if (!selected) {
    trace.fallbackReason = "extractor produced no candidates";
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: 0, reason: trace.fallbackReason, matchedTerms: [], matchedIntents: [] };
  }

  if (selected.kind === "chat") {
    trace.fallbackReason = `extractor selected chat:${selected.reason}`;
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: [] };
  }

  const typecheck = typecheckCommandIR(selected, resources);
  trace.typecheck = typecheck;
  if (!typecheck.ok) {
    trace.fallbackReason = `typecheck failed: ${typecheck.errors.join("; ")}`;
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: selected.intent ? [selected.intent] : [] };
  }

  const resolved = resolveCommandIR(selected, state);
  trace.resolved = resolved;
  if (!resolved) {
    trace.fallbackReason = "reference resolver produced no command";
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: selected.intent ? [selected.intent] : [] };
  }

  const lowered = lowerCommand(resolved, resources);
  trace.lowered = lowered;
  if (!lowered) {
    trace.fallbackReason = "no lowering rule matched command";
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: selected.intent ? [selected.intent] : [] };
  }

  const preconditions = checkCommandPreconditions(resolved, lowered.requiredContext);
  trace.preconditions = preconditions;
  if (!preconditions.ok) {
    trace.fallbackReason = `preconditions failed: ${preconditions.missing.join(", ")}`;
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: selected.intent ? [selected.intent] : [] };
  }

  if (!actionStillEligible(lowered.directExec, resources.actions)) {
    trace.fallbackReason = "lowered direct action is not in eligible direct-exec action set";
    return { handled: false, trace, executionMode: null, candidateSkill: null, directExec: null, confidence: selected.confidence, reason: trace.fallbackReason, matchedTerms: candidates[0]?.matchedTerms ?? [], matchedIntents: selected.intent ? [selected.intent] : [] };
  }

  return {
    handled: true,
    trace,
    executionMode: lowered.executionMode,
    candidateSkill: lowered.candidateSkill,
    directExec: lowered.directExec,
    confidence: selected.confidence,
    reason: lowered.reason,
    matchedTerms: candidates[0]?.matchedTerms ?? [],
    matchedIntents: selected.intent ? [selected.intent] : lowered.directExec?.matchedIntents ?? [],
  };
}
