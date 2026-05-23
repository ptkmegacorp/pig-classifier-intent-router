import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { compileVoiceCommand } from "./compiler/compiler.js";
import type { CommandCompilerTrace } from "./compiler/ir.js";

export type VoiceRouteBucket = "deterministic" | "normal_msg";
export type RouteExecutionMode = "pi_skill" | "direct_exec" | null;
export type RoutingIntent = string;
export type RoutingFamily = string;

export interface RoutingIntentMetadata {
  family: RoutingFamily | null;
  examples: string[];
  keywords: string[];
  negativeExamples: string[];
  requiredContext: string[];
}

export interface RoutingMetadata {
  enabled: boolean;
  deterministicAffordance: boolean;
  family: RoutingFamily | null;
  examples: string[];
  keywords: string[];
  negativeExamples: string[];
  intents: Record<RoutingIntent, RoutingIntentMetadata>;
}

export interface CompilerIntentMetadata {
  id: RoutingIntent;
  ir: Record<string, unknown>;
  examples: string[];
  keywords: string[];
  negativeExamples: string[];
}

export interface CompilerCommandSchemaMetadata {
  match: Record<string, unknown>;
  requiredFields: string[];
}

export interface CompilerLoweringMetadata {
  match: Record<string, unknown>;
  actionId?: string;
  fallbackSkill: string;
  matchedIntents: RoutingIntent[];
  requiredContext: string[];
  reason?: string;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  commandName: string | null;
  family: RoutingFamily | null;
  keywords: string[];
  examples: string[];
  negativeExamples: string[];
  intents: Record<RoutingIntent, RoutingIntentMetadata>;
  compilerIntents: CompilerIntentMetadata[];
  compilerSchemas: CompilerCommandSchemaMetadata[];
  compilerLowering: CompilerLoweringMetadata[];
}

export interface SkillScore {
  skill: string;
  score: number;
  matchedTerms: string[];
  matchedIntents: RoutingIntent[];
}

export interface DirectExecAction {
  id: string;
  skill: string;
  description: string;
  script: string;
  scriptPath: string;
  baseDir: string;
  directExec: boolean;
  safety: string;
  requiresConfirmation: boolean;
  defaultArgs: string[];
  keywords: string[];
  exactPhrases: string[];
  family: RoutingFamily | null;
  attachImageWhenIntent: RoutingIntent | null;
  runWhenIntent: RoutingIntent | null;
  requiredContext: string[];
  outputImageKey: string | null;
}

export interface DirectExecCandidate {
  actionId: string;
  skill: string;
  script: string;
  args: string[];
  score: number;
  matchedTerms: string[];
  matchedIntents: RoutingIntent[];
  safety: string;
  missingContext: string[];
  outputImageKey: string | null;
}

export interface VoiceRouteDecision {
  bucket: VoiceRouteBucket;
  executionMode: RouteExecutionMode;
  candidateSkill: string | null;
  directExec: DirectExecCandidate | null;
  confidence: number;
  reason: string;
  text: string;
  matchedTerms: string[];
  matchedIntents: RoutingIntent[];
  topCandidates: SkillScore[];
  compilerTrace: CommandCompilerTrace;
  timestamp: string;
}

export interface DirectExecResult {
  stdout: string;
  stderr: string;
}

export interface DiscoveredSkillCommand {
  name: string;
  description?: string;
  source: string;
  sourceInfo: {
    path: string;
    baseDir?: string;
  };
}

export interface RouteResources {
  catalog: SkillCatalogEntry[];
  actions: DirectExecAction[];
}

export interface ResolvedSkill {
  name: string;
  filePath: string;
  baseDir: string;
  body: string;
}

const execFileAsync = promisify(execFile);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function routingIntent(value: unknown): RoutingIntent | null {
  return typeof value === "string" && /^[a-z0-9_-]+$/.test(value) ? value : null;
}

function routingFamily(value: unknown): RoutingFamily | null {
  return typeof value === "string" && /^[a-z0-9_-]+$/.test(value) ? value : null;
}

function outputKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9_]+$/.test(value) ? value : null;
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  if (!raw.startsWith("---\n")) return { body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { body: raw };
  const fm = raw.slice(4, end);
  const body = raw.slice(end + "\n---\n".length);
  const out: { name?: string; description?: string; body: string } = { body };
  for (const line of fm.split("\n")) {
    const match = line.match(/^(name|description):\s*(.*)$/);
    if (!match) continue;
    out[match[1] as "name" | "description"] = match[2].replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "").trim();
  }
  return out;
}

function loadRoutingMetadata(skillDir: string): RoutingMetadata {
  const defaults: RoutingMetadata = {
    enabled: true,
    deterministicAffordance: true,
    family: null,
    examples: [],
    keywords: [],
    negativeExamples: [],
    intents: {},
  };
  const path = join(skillDir, "routing.json");
  if (!existsSync(path)) return defaults;

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const intents: Record<RoutingIntent, RoutingIntentMetadata> = {};
    if (raw && typeof raw.intents === "object") {
      for (const [intent, metadata] of Object.entries(raw.intents)) {
        if (!/^[a-z0-9_-]+$/.test(intent) || !metadata || typeof metadata !== "object") continue;
        intents[intent] = {
          family: routingFamily((metadata as { family?: unknown }).family),
          examples: stringArray((metadata as { examples?: unknown }).examples),
          keywords: stringArray((metadata as { keywords?: unknown }).keywords),
          negativeExamples: stringArray((metadata as { negativeExamples?: unknown }).negativeExamples),
          requiredContext: stringArray((metadata as { requiredContext?: unknown }).requiredContext),
        };
      }
    }

    return {
      enabled: raw.enabled !== false,
      deterministicAffordance: raw.deterministicAffordance !== false,
      family: routingFamily(raw.family),
      examples: stringArray(raw.examples),
      keywords: stringArray(raw.keywords),
      negativeExamples: stringArray(raw.negativeExamples),
      intents,
    };
  } catch {
    return defaults;
  }
}

function loadCompilerMetadata(skillDir: string): { intents: CompilerIntentMetadata[]; schemas: CompilerCommandSchemaMetadata[]; lowering: CompilerLoweringMetadata[] } {
  const path = join(skillDir, "compiler.json");
  if (!existsSync(path)) return { intents: [], schemas: [], lowering: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const intents = Array.isArray(raw.intents) ? raw.intents.flatMap((item: any): CompilerIntentMetadata[] => {
      const id = routingIntent(item?.id);
      if (!id || !item?.ir || typeof item.ir !== "object") return [];
      return [{ id, ir: item.ir, examples: stringArray(item.examples), keywords: stringArray(item.keywords), negativeExamples: stringArray(item.negativeExamples) }];
    }) : [];
    const schemas = Array.isArray(raw.schemas) ? raw.schemas.flatMap((item: any): CompilerCommandSchemaMetadata[] => {
      if (!item?.match || typeof item.match !== "object") return [];
      return [{ match: item.match, requiredFields: stringArray(item.requiredFields) }];
    }) : [];
    const lowering = Array.isArray(raw.lowering) ? raw.lowering.flatMap((item: any): CompilerLoweringMetadata[] => {
      if (!item?.match || typeof item.match !== "object" || typeof item.fallbackSkill !== "string") return [];
      return [{
        match: item.match,
        actionId: typeof item.actionId === "string" ? item.actionId : undefined,
        fallbackSkill: item.fallbackSkill,
        matchedIntents: stringArray(item.matchedIntents),
        requiredContext: stringArray(item.requiredContext),
        reason: typeof item.reason === "string" ? item.reason : undefined,
      }];
    }) : [];
    return { intents, schemas, lowering };
  } catch {
    return { intents: [], schemas: [], lowering: [] };
  }
}

function safeScriptPath(baseDir: string, script: string): string | null {
  if (isAbsolute(script) || script.includes("..")) return null;
  const full = resolve(baseDir, script);
  const scriptsDir = resolve(baseDir, "scripts");
  if (!full.startsWith(`${scriptsDir}/`)) return null;
  if (!existsSync(full)) return null;
  return full;
}

const DIRECT_EXEC_ALLOWED_SAFETY = new Set(["read_only_network", "read_only_local", "local_capture"]);

function isDirectExecSafe(action: any): boolean {
  return action?.directExec === true
    && action?.requiresConfirmation === false
    && typeof action?.safety === "string"
    && DIRECT_EXEC_ALLOWED_SAFETY.has(action.safety);
}

function skillNameFromCommand(command: DiscoveredSkillCommand, parsedName?: string): string | null {
  const commandName = command.name.startsWith("skill:") ? command.name.slice("skill:".length) : command.name;
  const name = parsedName ?? commandName;
  return /^[a-z0-9-]+$/.test(name) ? name : null;
}

export function loadSkillCatalogFromCommands(commands: DiscoveredSkillCommand[]): SkillCatalogEntry[] {
  const byName = new Map<string, SkillCatalogEntry>();
  for (const command of commands) {
    if (command.source !== "skill") continue;
    const skillFile = command.sourceInfo.path;
    // Load routing/direct-exec metadata beside the actual SKILL.md file.
    // command.sourceInfo.baseDir may point at the extension/package base dir.
    const skillDir = dirname(skillFile);
    try {
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf-8");
      const parsed = parseFrontmatter(raw);
      const name = skillNameFromCommand(command, parsed.name);
      if (!name || byName.has(name)) continue;
      const description = command.description ?? parsed.description ?? "";
      const routing = loadRoutingMetadata(skillDir);
      const compiler = loadCompilerMetadata(skillDir);
      if (!routing.enabled || !routing.deterministicAffordance) continue;
      const intentTerms = Object.values(routing.intents).flatMap((intent) => [...intent.examples, ...intent.keywords]);
      byName.set(name, {
        name,
        description,
        filePath: skillFile,
        baseDir: skillDir,
        commandName: command.name,
        family: routing.family,
        keywords: unique([...routing.examples, ...routing.keywords, ...intentTerms]),
        examples: routing.examples,
        negativeExamples: routing.negativeExamples,
        intents: routing.intents,
        compilerIntents: compiler.intents,
        compilerSchemas: compiler.schemas,
        compilerLowering: compiler.lowering,
      });
    } catch {
      // Ignore unreadable/broken skills in the compiler catalog.
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadDirectExecActionsForSkill(skill: SkillCatalogEntry): DirectExecAction[] {
  const metadataPath = join(skill.baseDir, "direct-exec.json");
  const actions: DirectExecAction[] = [];
  try {
    if (!existsSync(metadataPath)) return [];
    const raw = JSON.parse(readFileSync(metadataPath, "utf-8"));
    const routing = loadRoutingMetadata(skill.baseDir);
    const list = Array.isArray(raw.actions) ? raw.actions : [];
    for (const action of list) {
      if (!isDirectExecSafe(action)) continue;
      if (typeof action.id !== "string" || typeof action.script !== "string") continue;
      const scriptPath = safeScriptPath(skill.baseDir, action.script);
      if (!scriptPath) continue;
      const attachImageWhenIntent = routingIntent(action.attachImageWhenIntent);
      const runWhenIntent = routingIntent(action.runWhenIntent);
      const actionIntent = attachImageWhenIntent ?? runWhenIntent;
      const actionFamily = routingFamily(action.family) ?? (actionIntent ? routing.intents[actionIntent]?.family ?? null : null) ?? routing.family;
      const requiredContext = unique([
        ...stringArray(action.requiredContext),
        ...(actionIntent ? routing.intents[actionIntent]?.requiredContext ?? [] : []),
      ]);
      actions.push({
        id: action.id,
        skill: skill.name,
        description: typeof action.description === "string" ? action.description : "",
        script: normalize(action.script),
        scriptPath,
        baseDir: skill.baseDir,
        directExec: true,
        safety: action.safety,
        requiresConfirmation: false,
        defaultArgs: Array.isArray(action.defaultArgs) ? action.defaultArgs.map(String) : [],
        keywords: stringArray(action.keywords),
        exactPhrases: stringArray(action.exactPhrases),
        family: actionFamily,
        attachImageWhenIntent,
        runWhenIntent,
        requiredContext,
        outputImageKey: outputKey(action.outputImageKey),
      });
    }
  } catch {
    // Ignore malformed direct-exec metadata; skill path remains available.
  }
  return actions;
}

export function loadDirectExecActionsFromCatalog(catalog: SkillCatalogEntry[]): DirectExecAction[] {
  return catalog.flatMap(loadDirectExecActionsForSkill).sort((a, b) => a.id.localeCompare(b.id));
}

export function loadRouteResourcesFromCommands(commands: DiscoveredSkillCommand[]): RouteResources {
  const catalog = loadSkillCatalogFromCommands(commands);
  return { catalog, actions: loadDirectExecActionsFromCatalog(catalog) };
}

export async function routeVoiceTranscript(text: string, resources: RouteResources): Promise<VoiceRouteDecision> {
  const cleaned = text.trim();
  const compiler = await compileVoiceCommand(cleaned, resources);
  if (compiler.handled) {
    return {
      bucket: "deterministic",
      executionMode: compiler.executionMode,
      candidateSkill: compiler.candidateSkill,
      directExec: compiler.directExec,
      confidence: compiler.confidence,
      reason: `compiler route: ${compiler.reason}`,
      text: cleaned,
      matchedTerms: compiler.matchedTerms,
      matchedIntents: compiler.matchedIntents,
      topCandidates: [],
      compilerTrace: compiler.trace,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    bucket: "normal_msg",
    executionMode: null,
    candidateSkill: null,
    directExec: null,
    confidence: compiler.confidence,
    reason: compiler.reason || "compiler did not produce an executable deterministic command; default normal message to Pig",
    text: cleaned,
    matchedTerms: compiler.matchedTerms,
    matchedIntents: compiler.matchedIntents,
    topCandidates: [],
    compilerTrace: compiler.trace,
    timestamp: new Date().toISOString(),
  };
}

export function getVoiceDispatchLogPath(): string {
  return process.env.PI_VOICE_DISPATCH_LOG ?? join(homedir(), ".pi", "voice-dispatcher.jsonl");
}

export function logVoiceRouteDecision(decision: VoiceRouteDecision): void {
  if (process.env.PI_VOICE_DISPATCH_LOG_DISABLE === "1") return;
  const path = getVoiceDispatchLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(decision)}\n`, { encoding: "utf-8", mode: 0o600 });
}

export function resolveSkill(name: string, catalog?: SkillCatalogEntry[]): ResolvedSkill | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const catalogEntry = catalog?.find((entry) => entry.name === name);
  if (!catalogEntry || !existsSync(catalogEntry.filePath)) return null;
  const raw = readFileSync(catalogEntry.filePath, "utf-8");
  const parsed = parseFrontmatter(raw);
  return { name, filePath: catalogEntry.filePath, baseDir: catalogEntry.baseDir, body: parsed.body.trim() };
}

export function buildSkillUserMessage(skill: ResolvedSkill, userText: string): string {
  const safeName = basename(skill.baseDir);
  const skillBlock = `<skill name="${safeName}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${skill.body}\n</skill>`;
  return `${skillBlock}\n\n${userText}`;
}

export async function runDirectExecAction(candidate: DirectExecCandidate, timeoutMs: number, actions: DirectExecAction[]): Promise<DirectExecResult> {
  const action = actions.find((item) => item.id === candidate.actionId && item.skill === candidate.skill);
  if (!action) throw new Error(`Direct-exec action not found or not eligible: ${candidate.actionId}`);
  const { stdout, stderr } = await execFileAsync(action.scriptPath, action.defaultArgs, {
    cwd: action.baseDir,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr };
}

export function findDirectExecImagePath(decision: VoiceRouteDecision, result: DirectExecResult): string | null {
  const key = decision.directExec?.outputImageKey;
  if (!key) return null;
  const match = result.stdout.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim() || null;
}

export function shouldAttachDirectExecImage(decision: VoiceRouteDecision): boolean {
  return Boolean(decision.directExec?.outputImageKey && decision.directExec.matchedIntents.length > 0);
}

export function buildVisualInspectionMessage(decision: VoiceRouteDecision, imagePath: string, result: DirectExecResult): string {
  return [
    `User request: ${decision.text}`,
    `Attached image path: ${imagePath}`,
    "",
    "Answer the user's visual question from the attached image. Do not say you need to call read or open the file; the image is already attached. If the answer is not visible, say that briefly.",
    "",
    "CAPTURE_STDOUT:",
    result.stdout.trim() || "(empty)",
    result.stderr.trim() ? `\nCAPTURE_STDERR:\n${result.stderr.trim()}` : "",
  ].filter(Boolean).join("\n");
}

export function buildDirectExecResultMessage(decision: VoiceRouteDecision, result: DirectExecResult): string {
  return [
    `Direct execution result for: ${decision.text}`,
    `Action: ${decision.directExec?.actionId ?? "unknown"}`,
    `Safety: ${decision.directExec?.safety ?? "unknown"}`,
    "",
    "Use the script output below to answer the user's original request concisely. Do not invent data not present in the output.",
    "",
    "SCRIPT_STDOUT:",
    result.stdout.trim() || "(empty)",
    result.stderr.trim() ? `\nSCRIPT_STDERR:\n${result.stderr.trim()}` : "",
  ].filter(Boolean).join("\n");
}
