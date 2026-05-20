import type { DirectExecCandidate, RoutingIntent } from "../router.js";
import type { PigCommandState } from "./state.js";

export type CommandDomain = "screen" | "image" | "weather";
export type CommandAction = "capture" | "open" | "show" | "inspect" | "lookup";
export type CommandObject = "screen" | "screenshot" | "photo" | "image" | "weather";
export type CommandTarget = "current" | "last" | "recent" | "attached";

export interface ChatIR {
  kind: "chat";
  reason: "phatic" | "general_question" | "ambiguous" | "no_command";
  confidence: number;
}

export interface BaseCommandIR {
  kind: "command";
  domain: CommandDomain;
  action: CommandAction;
  object: CommandObject;
  target?: CommandTarget;
  confidence: number;
  intent?: RoutingIntent;
}

export interface ScreenCommandIR extends BaseCommandIR {
  domain: "screen";
  action: "capture" | "open" | "show" | "inspect";
  object: "screen" | "screenshot";
  target?: "current" | "last" | "recent";
}

export interface ImageCommandIR extends BaseCommandIR {
  domain: "image";
  action: "capture" | "open" | "show" | "inspect";
  object: "photo" | "image";
  target?: "current" | "last" | "recent" | "attached";
}

export interface WeatherCommandIR extends BaseCommandIR {
  domain: "weather";
  action: "lookup";
  object: "weather";
  target?: "current";
  time?: "today" | "tomorrow" | "tonight" | string;
  location?: string;
}

export type CommandIR = ChatIR | ScreenCommandIR | ImageCommandIR | WeatherCommandIR;

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
  ir: Exclude<CommandIR, ChatIR>;
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
