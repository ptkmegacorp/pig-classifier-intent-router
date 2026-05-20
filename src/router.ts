import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";

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

export interface SkillCatalogEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  commandName: string | null;
  family: RoutingFamily | null;
  /** Terms/phrases that make this skill a known deterministic affordance. */
  keywords: string[];
  examples: string[];
  negativeExamples: string[];
  intents: Record<RoutingIntent, RoutingIntentMetadata>;
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

export interface BroadGateDecision {
  bucket: VoiceRouteBucket;
  deterministicKind: "skill_or_action" | null;
  confidence: number;
  reason: string;
  matchedTerms: string[];
  matchedFamilies: RoutingFamily[];
}

export interface VoiceRouteDecision {
  /** Final runtime bucket: either deterministic or normal fallback. */
  bucket: VoiceRouteBucket;
  /** Execution mode inside the deterministic bucket. */
  executionMode: RouteExecutionMode;
  /** First-stage rules gate. Later this can be a tiny classifier. */
  broadGate: BroadGateDecision;
  candidateSkill: string | null;
  directExec: DirectExecCandidate | null;
  confidence: number;
  reason: string;
  text: string;
  matchedTerms: string[];
  matchedIntents: RoutingIntent[];
  topCandidates: SkillScore[];
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

const PI_SKILL_THRESHOLD = Number(process.env.PI_VOICE_SKILL_THRESHOLD ?? "0.5");
const PI_SKILL_MARGIN = Number(process.env.PI_VOICE_SKILL_MARGIN ?? "0.12");
const DIRECT_EXEC_THRESHOLD = Number(process.env.PI_VOICE_DIRECT_EXEC_THRESHOLD ?? "0.85");
const execFileAsync = promisify(execFile);

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "use", "user", "when", "with",
  "asks", "ask", "agent", "ai", "pig", "pi", "current", "latest", "today", "what", "this", "that", "there", "here",
]);

function unique(values: string[]): string[] {
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

function tokenizeAll(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function tokenize(text: string): string[] {
  return unique(tokenizeAll(text));
}

function normalizeForPhrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function phraseMatches(text: string, phrase: string): boolean {
  return normalizeForPhrase(text).includes(normalizeForPhrase(phrase));
}

function termMatches(text: string, tokens: Set<string>, term: string): boolean {
  return term.includes(" ") ? phraseMatches(text, term) : tokens.has(term.toLowerCase());
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

function safeScriptPath(baseDir: string, script: string): string | null {
  if (isAbsolute(script) || script.includes("..")) return null;
  const full = resolve(baseDir, script);
  const scriptsDir = resolve(baseDir, "scripts");
  if (!full.startsWith(`${scriptsDir}/`)) return null;
  if (!existsSync(full)) return null;
  return full;
}

const DIRECT_EXEC_ALLOWED_SAFETY = new Set([
  "read_only_network",
  "read_only_local",
  "local_capture",
]);

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
    const skillDir = command.sourceInfo.baseDir ?? dirname(skillFile);
    try {
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf-8");
      const parsed = parseFrontmatter(raw);
      const name = skillNameFromCommand(command, parsed.name);
      if (!name || byName.has(name)) continue;
      const description = command.description ?? parsed.description ?? "";
      const routing = loadRoutingMetadata(skillDir);
      if (!routing.enabled || !routing.deterministicAffordance) continue;
      const intentTerms = Object.values(routing.intents).flatMap((intent) => [...intent.examples, ...intent.keywords]);
      const keywords = unique([
        ...routing.examples,
        ...routing.keywords,
        ...intentTerms,
      ]);
      byName.set(name, {
        name,
        description,
        filePath: skillFile,
        baseDir: skillDir,
        commandName: command.name,
        family: routing.family,
        keywords,
        examples: routing.examples,
        negativeExamples: routing.negativeExamples,
        intents: routing.intents,
      });
    } catch {
      // Ignore unreadable/broken skills in the router catalog.
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

interface RoutingTerm {
  term: string;
  family: RoutingFamily | null;
}

function routingTermsForSkill(skill: SkillCatalogEntry): RoutingTerm[] {
  const terms: RoutingTerm[] = skill.keywords.map((term) => ({ term, family: skill.family }));
  for (const metadata of Object.values(skill.intents)) {
    const family = metadata.family ?? skill.family;
    for (const term of [...metadata.examples, ...metadata.keywords]) terms.push({ term, family });
  }
  return terms;
}

function broadGate(text: string, catalog: SkillCatalogEntry[], actions: DirectExecAction[]): BroadGateDecision {
  const negativeMatches = catalog.flatMap((skill) => skill.negativeExamples).filter((term) => phraseMatches(text, term));
  if (negativeMatches.length > 0) {
    return {
      bucket: "normal_msg",
      deterministicKind: null,
      confidence: 0.05,
      reason: "matched known negative routing example",
      matchedTerms: unique(negativeMatches),
      matchedFamilies: [],
    };
  }

  const terms = [
    ...catalog.flatMap(routingTermsForSkill),
    ...actions.flatMap((action) => [...action.keywords, ...action.exactPhrases].map((term) => ({ term, family: action.family }))),
  ];
  const tokens = new Set(tokenize(text));
  const matches = terms.filter(({ term }) => termMatches(text, tokens, term));

  if (matches.length > 0) {
    return {
      bucket: "deterministic",
      deterministicKind: "skill_or_action",
      confidence: Math.min(0.99, 0.35 + matches.length * 0.12),
      reason: "matched known deterministic affordance term(s); run selector and execution gate",
      matchedTerms: unique(matches.map(({ term }) => term)),
      matchedFamilies: unique(matches.map(({ family }) => family).filter((family): family is RoutingFamily => Boolean(family))),
    };
  }

  return {
    bucket: "normal_msg",
    deterministicKind: null,
    confidence: 0.05,
    reason: "no broad deterministic affordance matched",
    matchedTerms: [],
    matchedFamilies: [],
  };
}

interface Bm25Document {
  skill: string;
  intent: RoutingIntent | null;
  family: RoutingFamily | null;
  phrases: string[];
  negativePhrases: string[];
  requiredContext: string[];
  tokens: string[];
  tokenCounts: Map<string, number>;
  length: number;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function bm25Document(skill: string, intent: RoutingIntent | null, family: RoutingFamily | null, fields: string[], negativePhrases: string[] = [], requiredContext: string[] = []): Bm25Document {
  const phrases = unique(fields.filter((field) => field.trim().length > 0));
  const tokens = fields.flatMap(tokenizeAll);
  return {
    skill,
    intent,
    family,
    phrases,
    negativePhrases: unique(negativePhrases),
    requiredContext: unique(requiredContext),
    tokens,
    tokenCounts: countTokens(tokens),
    length: Math.max(1, tokens.length),
  };
}

function buildBm25Documents(catalog: SkillCatalogEntry[]): Bm25Document[] {
  const docs: Bm25Document[] = [];
  for (const skill of catalog) {
    docs.push(bm25Document(skill.name, null, skill.family, [
      skill.name.replace(/-/g, " "),
      skill.description,
      ...skill.examples,
      ...skill.keywords,
    ], skill.negativeExamples));
    for (const [intent, metadata] of Object.entries(skill.intents)) {
      docs.push(bm25Document(skill.name, intent, metadata.family ?? skill.family, [
        intent.replace(/[_-]/g, " "),
        ...metadata.examples,
        ...metadata.keywords,
      ], metadata.negativeExamples, metadata.requiredContext));
    }
  }
  return docs;
}

function bm25Score(queryTokens: string[], doc: Bm25Document, docs: Bm25Document[], avgDocLength: number): number {
  const k1 = 1.2;
  const b = 0.75;
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

function matchedDocumentTerms(text: string, doc: Bm25Document, queryTokens: Set<string>): string[] {
  const phraseMatchesForDoc = doc.phrases.filter((phrase) => phrase.includes(" ") && phraseMatches(text, phrase));
  const tokenMatchesForDoc = unique(doc.tokens.filter((token) => queryTokens.has(token)));
  return unique([...phraseMatchesForDoc, ...tokenMatchesForDoc]);
}

function screenshotDir(): string {
  return process.env.SCREENSHOT_DIR ?? "/home/bot/screenshots";
}

function hasDisplayContext(): boolean {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || existsSync("/tmp/.X11-unix/X0"));
}

function hasRecentScreenshotPath(): boolean {
  return existsSync(join(screenshotDir(), "latest-screenshot"));
}

function missingRequiredContext(requiredContext: string[]): string[] {
  return unique(requiredContext).filter((item) => {
    switch (item) {
      case "active_display":
        return !hasDisplayContext();
      case "recent_screenshot_path":
        return !hasRecentScreenshotPath();
      default:
        return false;
    }
  });
}

/** Layer 2 selector: lightweight in-memory BM25 over skill and intent metadata docs. */
function selectSkillCandidate(text: string, catalog: SkillCatalogEntry[], allowedFamilies: RoutingFamily[]): SkillScore[] {
  const allDocs = buildBm25Documents(catalog);
  const familySet = new Set(allowedFamilies);
  const docs = allowedFamilies.length > 0
    ? allDocs.filter((doc) => !doc.family || familySet.has(doc.family))
    : allDocs;
  if (docs.length === 0) return [];

  const queryTokens = tokenizeAll(text);
  if (queryTokens.length === 0) return [];

  const queryTokenSet = new Set(queryTokens);
  const avgDocLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
  const rankedDocs = docs
    .map((doc) => {
      const matchedNegativePhrases = doc.negativePhrases.filter((phrase) => phraseMatches(text, phrase));
      if (matchedNegativePhrases.length > 0) {
        return {
          doc,
          rawScore: 0,
          matchedTerms: matchedNegativePhrases,
          matchedIntent: false,
        };
      }
      const matchedPhrases = doc.phrases.filter((phrase) => phrase.includes(" ") && phraseMatches(text, phrase));
      const phraseBoost = matchedPhrases.length * 1.5;
      const rawScore = bm25Score(queryTokens, doc, docs, avgDocLength) + phraseBoost;
      return {
        doc,
        rawScore,
        matchedTerms: matchedDocumentTerms(text, doc, queryTokenSet),
        matchedIntent: Boolean(doc.intent && matchedPhrases.length > 0),
      };
    })
    .filter((result) => result.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore);

  const bySkill = new Map<string, { rawScore: number; matchedTerms: string[]; matchedIntents: RoutingIntent[] }>();
  for (const result of rankedDocs) {
    const current = bySkill.get(result.doc.skill) ?? { rawScore: 0, matchedTerms: [], matchedIntents: [] };
    current.rawScore = Math.max(current.rawScore, result.rawScore);
    current.matchedTerms = unique([...current.matchedTerms, ...result.matchedTerms]);
    if (result.doc.intent && result.matchedIntent) current.matchedIntents = unique([...current.matchedIntents, result.doc.intent]);
    bySkill.set(result.doc.skill, current);
  }

  return [...bySkill.entries()]
    .map(([skill, result]) => ({
      skill,
      score: Math.min(0.99, Number((result.rawScore / (result.rawScore + 1.5)).toFixed(2))),
      matchedTerms: result.matchedTerms,
      matchedIntents: result.matchedIntents,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function scoreDirectExecAction(text: string, action: DirectExecAction, selectedSkill: SkillScore | null): DirectExecCandidate {
  const tokens = new Set(tokenize(text));
  const matchedTerms: string[] = [];
  const matchedIntents: RoutingIntent[] = [];
  const missingContext = missingRequiredContext(action.requiredContext);
  let score = 0;

  if (selectedSkill?.skill === action.skill) score += 0.18;

  for (const phrase of action.exactPhrases) {
    if (!phraseMatches(text, phrase)) continue;
    matchedTerms.push(phrase);
    score += 0.65;
  }

  for (const keyword of action.keywords) {
    const matched = termMatches(text, tokens, keyword);
    if (!matched) continue;
    matchedTerms.push(keyword);
    score += keyword.includes(" ") ? 0.25 : 0.08;
  }

  if (selectedSkill?.skill === action.skill && action.attachImageWhenIntent && selectedSkill.matchedIntents.includes(action.attachImageWhenIntent)) {
    matchedIntents.push(action.attachImageWhenIntent);
    score = Math.max(score, DIRECT_EXEC_THRESHOLD);
  }

  if (selectedSkill?.skill === action.skill && action.runWhenIntent && selectedSkill.matchedIntents.includes(action.runWhenIntent)) {
    matchedIntents.push(action.runWhenIntent);
    score = Math.max(score, DIRECT_EXEC_THRESHOLD);
  }

  return {
    actionId: action.id,
    skill: action.skill,
    script: action.script,
    args: action.defaultArgs,
    score: missingContext.length > 0 ? 0 : Math.min(0.99, Number(score.toFixed(2))),
    matchedTerms: unique(matchedTerms),
    matchedIntents: unique(matchedIntents),
    safety: action.safety,
    missingContext,
    outputImageKey: action.outputImageKey,
  };
}

function selectDirectExecCandidate(text: string, actions: DirectExecAction[], selectedSkill: SkillScore | null): DirectExecCandidate | null {
  const best = actions
    .map((action) => scoreDirectExecAction(text, action, selectedSkill))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < DIRECT_EXEC_THRESHOLD) return null;
  return best;
}

/**
 * General phase-2 transcript router.
 *
 * Core question: does the transcript confidently match one of our known
 * deterministic affordances? If yes, use that deterministic path. If not, fall
 * back to Gemma/Pi as a normal message.
 *
 * Buckets:
 * - deterministic: known affordance; executionMode chooses direct_exec or pi_skill.
 * - normal_msg: safe fallback; send the transcript to Pi normally.
 *
 * Execution modes:
 * - direct_exec: exact, explicitly opted-in read-only script path.
 * - pi_skill: contextual skill expansion path.
 */
export function routeVoiceTranscript(text: string, resources: RouteResources): VoiceRouteDecision {
  const cleaned = text.trim();
  const { catalog, actions: directActions } = resources;
  const gate = broadGate(cleaned, catalog, directActions);

  if (gate.bucket === "normal_msg") {
    return {
      bucket: "normal_msg",
      executionMode: null,
      broadGate: gate,
      candidateSkill: null,
      directExec: null,
      confidence: gate.confidence,
      reason: "broad gate chose normal_msg; default normal message to Pi",
      text: cleaned,
      matchedTerms: gate.matchedTerms,
      matchedIntents: [],
      topCandidates: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Deterministic broad bucket: first select the affordance/skill. This selector
  // is the planned replacement point for embeddings, followed later by optional CE reranking.
  const candidates = selectSkillCandidate(cleaned, catalog, gate.matchedFamilies);
  const best = candidates[0];
  const second = candidates[1];
  const margin = best && second ? best.score - second.score : best ? best.score : 0;
  const skillConfident = Boolean(best && best.score >= PI_SKILL_THRESHOLD && (!second || margin >= PI_SKILL_MARGIN));
  const selectedSkill = skillConfident && best ? best : null;
  const attachIntentSkill = best?.matchedIntents.length ? best : null;

  // Third node: if metadata says a script is safe and the request is exact enough,
  // route as direct_exec. Otherwise deterministic requests use the contextual skill path.
  const directExec = selectDirectExecCandidate(cleaned, directActions, selectedSkill ?? attachIntentSkill);
  if (directExec) {
    return {
      bucket: "deterministic",
      executionMode: "direct_exec",
      broadGate: gate,
      candidateSkill: directExec.skill,
      directExec,
      confidence: directExec.score,
      reason: `broad gate chose deterministic; execution gate selected direct_exec above threshold (${DIRECT_EXEC_THRESHOLD})`,
      text: cleaned,
      matchedTerms: directExec.matchedTerms,
      matchedIntents: directExec.matchedIntents,
      topCandidates: candidates,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    bucket: skillConfident ? "deterministic" : "normal_msg",
    executionMode: skillConfident ? "pi_skill" : null,
    broadGate: gate,
    candidateSkill: selectedSkill?.skill ?? null,
    directExec: null,
    confidence: best ? best.score : gate.confidence,
    reason: skillConfident
      ? `broad gate chose deterministic; selector matched skill above threshold (${PI_SKILL_THRESHOLD}) and margin (${PI_SKILL_MARGIN}); execution gate chose contextual pi_skill path`
      : best
        ? "broad gate chose deterministic, but selector confidence/margin was too low; default normal message to Pi"
        : "broad gate chose deterministic, but selector found no candidate; default normal message to Pi",
    text: cleaned,
    matchedTerms: best?.matchedTerms ?? gate.matchedTerms,
    matchedIntents: best?.matchedIntents ?? [],
    topCandidates: candidates,
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
  return {
    name,
    filePath: catalogEntry.filePath,
    baseDir: catalogEntry.baseDir,
    body: parsed.body.trim(),
  };

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
