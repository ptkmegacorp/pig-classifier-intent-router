import type { CommandAction, CommandDomain, CommandObject, CommandTarget, LoweredCommand, ResolvedCommand } from "./ir.js";
import type { CompilerLoweringMetadata, DirectExecAction, DirectExecCandidate, RouteResources, RoutingIntent } from "../router.js";

interface LoweringRule {
  domain?: CommandDomain;
  action?: CommandAction | CommandAction[];
  object?: CommandObject | CommandObject[];
  target?: CommandTarget | CommandTarget[];
  actionId?: string;
  fallbackSkill: string;
  matchedIntents: RoutingIntent[];
  requiredContext: string[];
  reason?: string;
}

function includes<T extends string>(expected: T | T[] | undefined, actual: T | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function asList(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return undefined;
}

function ruleFromMetadata(metadata: CompilerLoweringMetadata): LoweringRule | null {
  const match = metadata.match;
  return {
    domain: typeof match.domain === "string" ? match.domain as CommandDomain : undefined,
    action: asList(match.action) as CommandAction[] | undefined,
    object: asList(match.object) as CommandObject[] | undefined,
    target: asList(match.target) as CommandTarget[] | undefined,
    actionId: metadata.actionId,
    fallbackSkill: metadata.fallbackSkill,
    matchedIntents: metadata.matchedIntents,
    requiredContext: metadata.requiredContext,
    reason: metadata.reason,
  };
}

function loweringRules(resources: RouteResources): LoweringRule[] {
  return resources.catalog.flatMap((skill) => skill.compilerLowering.map(ruleFromMetadata).filter((rule): rule is LoweringRule => Boolean(rule)));
}

function ruleMatches(rule: LoweringRule, resolved: ResolvedCommand): boolean {
  const { ir } = resolved;
  return includes(rule.domain, ir.domain)
    && includes(rule.action, ir.action)
    && includes(rule.object, ir.object)
    && includes(rule.target, ir.target);
}

function directCandidate(action: DirectExecAction, score: number, matchedIntents: RoutingIntent[] = [], requiredContext: string[] = []): DirectExecCandidate {
  return {
    actionId: action.id,
    skill: action.skill,
    script: action.script,
    args: action.defaultArgs,
    score,
    matchedTerms: [action.id],
    matchedIntents,
    safety: action.safety,
    missingContext: [],
    outputImageKey: action.outputImageKey,
  };
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

export function lowerCommand(resolved: ResolvedCommand, resources: RouteResources): LoweredCommand | null {
  const rule = loweringRules(resources).find((candidate) => ruleMatches(candidate, resolved));
  if (!rule) return null;
  const action = rule.actionId ? resources.actions.find((item) => item.id === rule.actionId) : null;
  const requiredContext = unique([...(rule.requiredContext ?? []), ...(action?.requiredContext ?? [])]);

  if (action) {
    return {
      executionMode: "direct_exec",
      candidateSkill: action.skill,
      directExec: directCandidate(action, resolved.ir.confidence, rule.matchedIntents, requiredContext),
      requiredContext,
      reason: rule.reason ?? `lowered command to ${action.id}`,
    };
  }

  return {
    executionMode: "pi_skill",
    candidateSkill: rule.fallbackSkill,
    directExec: null,
    requiredContext,
    reason: `no eligible direct action${rule.actionId ? ` for lowering rule ${rule.actionId}` : ""}; use contextual skill`,
  };
}

export function getLoweringRules(resources?: RouteResources): readonly LoweringRule[] {
  return resources ? loweringRules(resources) : [];
}
