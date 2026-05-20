import type { CommandAction, CommandDomain, CommandObject, CommandTarget, LoweredCommand, ResolvedCommand } from "./ir.js";
import type { DirectExecAction, DirectExecCandidate, RoutingIntent } from "../router.js";

interface LoweringRule {
  domain: CommandDomain;
  action: CommandAction | CommandAction[];
  object?: CommandObject | CommandObject[];
  target?: CommandTarget | CommandTarget[];
  actionId?: string;
  fallbackSkill: string;
  matchedIntents?: RoutingIntent[];
  reason: string;
}

const LOWERING_RULES: LoweringRule[] = [
  {
    domain: "screen",
    action: "capture",
    object: "screenshot",
    target: "current",
    actionId: "take-screenshot.capture",
    fallbackSkill: "take-screenshot",
    reason: "lowered screen capture to screenshot capture action",
  },
  {
    domain: "screen",
    action: "inspect",
    object: ["screen", "screenshot"],
    actionId: "take-screenshot.capture",
    fallbackSkill: "take-screenshot",
    matchedIntents: ["visual_inspect"],
    reason: "lowered screen inspection to screenshot capture with image attachment",
  },
  {
    domain: "screen",
    action: ["open", "show"],
    object: "screenshot",
    target: ["last", "recent"],
    actionId: "take-screenshot.view-latest",
    fallbackSkill: "take-screenshot",
    matchedIntents: ["display_to_user"],
    reason: "lowered screenshot display to latest-screenshot viewer",
  },
  {
    domain: "image",
    action: "capture",
    object: ["photo", "image"],
    actionId: "take-photo.capture",
    fallbackSkill: "take-photo",
    reason: "lowered image capture to phone photo capture action",
  },
  {
    domain: "image",
    action: "inspect",
    object: ["photo", "image"],
    actionId: "take-photo.capture",
    fallbackSkill: "take-photo",
    matchedIntents: ["visual_inspect"],
    reason: "lowered image inspection to phone photo capture with image attachment",
  },
  {
    domain: "weather",
    action: "lookup",
    object: "weather",
    actionId: "weather.brief",
    fallbackSkill: "weather",
    reason: "lowered weather lookup to weather brief action",
  },
];

function includes<T extends string>(expected: T | T[] | undefined, actual: T | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function ruleMatches(rule: LoweringRule, resolved: ResolvedCommand): boolean {
  const { ir } = resolved;
  return rule.domain === ir.domain
    && includes(rule.action, ir.action)
    && includes(rule.object, ir.object)
    && includes(rule.target, ir.target);
}

function directCandidate(action: DirectExecAction, score: number, matchedIntents: RoutingIntent[] = []): DirectExecCandidate {
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

export function lowerCommand(resolved: ResolvedCommand, actions: DirectExecAction[]): LoweredCommand | null {
  const rule = LOWERING_RULES.find((candidate) => ruleMatches(candidate, resolved));
  if (!rule) return null;

  if (rule.actionId) {
    const action = actions.find((item) => item.id === rule.actionId);
    if (action) {
      return {
        executionMode: "direct_exec",
        candidateSkill: action.skill,
        directExec: directCandidate(action, resolved.ir.confidence, rule.matchedIntents ?? []),
        reason: rule.reason,
      };
    }
  }

  return {
    executionMode: "pi_skill",
    candidateSkill: rule.fallbackSkill,
    directExec: null,
    reason: `no eligible direct action for lowering rule${rule.actionId ? ` ${rule.actionId}` : ""}; use contextual skill`,
  };
}

export function getLoweringRules(): readonly LoweringRule[] {
  return LOWERING_RULES;
}
