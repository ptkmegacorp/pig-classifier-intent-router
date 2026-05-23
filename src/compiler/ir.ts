import type { DirectExecCandidate, RoutingIntent } from "../router.js";
import type { PigCommandState } from "./state.js";

export type CommandDomain = string;
export type CommandAction = string;
export type CommandObject = string;
export type CommandTarget = string;
export type CommandSlots = Record<string, string | number | boolean | null | string[]>;

export interface ChatIR {
  kind: "chat";
  reason: "phatic" | "general_question" | "ambiguous" | "no_command";
  confidence: number;
}

export interface CommandIRShape {
  kind: "command";
  domain: CommandDomain;
  action: CommandAction;
  object: CommandObject;
  target?: CommandTarget;
  slots?: CommandSlots;
  confidence: number;
  intent?: RoutingIntent;
  /** Compatibility convenience fields; new domains should prefer slots. */
  time?: string;
  location?: string;
}

export type ScreenCommandIR = CommandIRShape;
export type ImageCommandIR = CommandIRShape;
export type WeatherCommandIR = CommandIRShape;
export type CommandIR = ChatIR | CommandIRShape;

export interface CommandIRCandidate {
  ir: CommandIR;
  extractor: string;
  matchedTerms: string[];
  reason: string;
}

export interface TypecheckResult {
  ok: boolean;
  errors: string[];
}

export interface ResolvedCommand {
  ir: CommandIRShape;
  refs: Record<string, string>;
  state: PigCommandState;
}

export interface PreconditionResult {
  ok: boolean;
  missing: string[];
}

export interface LoweredCommand {
  executionMode: "direct_exec" | "pi_skill";
  candidateSkill: string | null;
  directExec: DirectExecCandidate | null;
  requiredContext: string[];
  reason: string;
}

export interface CommandCompilerTrace {
  enabled: true;
  extractors: string[];
  state: PigCommandState | null;
  candidates: CommandIRCandidate[];
  selectedIR: CommandIR | null;
  typecheck: TypecheckResult | null;
  resolved: ResolvedCommand | null;
  preconditions: PreconditionResult | null;
  lowered: LoweredCommand | null;
  fallbackReason: string | null;
}

export interface CommandCompilerDecision {
  handled: boolean;
  trace: CommandCompilerTrace;
  executionMode: "direct_exec" | "pi_skill" | null;
  candidateSkill: string | null;
  directExec: DirectExecCandidate | null;
  confidence: number;
  reason: string;
  matchedTerms: string[];
  matchedIntents: RoutingIntent[];
}
