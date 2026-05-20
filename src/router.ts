import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";

export type VoiceRouteBucket = "deterministic" | "normal_msg";
export type RouteExecutionMode = "pi_skill" | "direct_exec" | null;

export interface SkillCatalogEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  /** Terms/phrases that make this skill a known deterministic affordance. */
  keywords: string[];
}

export interface SkillScore {
  skill: string;
  score: number;
  matchedTerms: string[];
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
}

export interface DirectExecCandidate {
  actionId: string;
  skill: string;
  script: string;
  args: string[];
  score: number;
  matchedTerms: string[];
  safety: string;
}

export interface BroadGateDecision {
  bucket: VoiceRouteBucket;
  deterministicKind: "skill_or_action" | null;
  confidence: number;
  reason: string;
  matchedTerms: string[];
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
  topCandidates: SkillScore[];
  timestamp: string;
}

export interface DirectExecResult {
  stdout: string;
  stderr: string;
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
  "asks", "ask", "agent", "ai", "pig", "pi", "current", "latest", "what", "this", "that", "there", "here",
]);

const SKILL_ALIASES: Record<string, string[]> = {
  weather: [
    "weather", "forecast", "temperature", "temp", "rain", "raining", "snow", "snowing", "wind", "windy", "storm", "storms", "thunderstorm", "radar", "alert", "alerts", "warning", "warnings", "jacket", "umbrella", "outside", "tonight", "tomorrow", "weekend",
  ],
  "take-screenshot": [
    "screenshot", "screen shot", "take screenshot", "take a screenshot", "screen", "desktop", "display", "visible", "inspect screen", "what is on screen", "what's on screen", "read screen", "current screen", "view screenshot", "show screenshot", "capture screen", "capture screenshot",
  ],
  "take-photo": [
    "photo", "picture", "camera", "take photo", "take a photo", "take picture", "take a picture", "phone photo", "android photo", "snap photo", "capture photo",
  ],
};

function skillRoots(): string[] {
  const explicitRoot = process.env.PI_VOICE_SKILL_ROOT;
  return [
    explicitRoot,
    join(homedir(), ".pig", "agent", "skills"),
    join(process.cwd(), ".pig", "skills"),
    ...(process.env.PI_VOICE_INCLUDE_PI_SKILLS === "1" ? [
      join(homedir(), ".pi", "agent", "skills"),
      join(process.cwd(), ".pi", "skills"),
    ] : []),
  ].filter((root): root is string => Boolean(root));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function tokenize(text: string): string[] {
  return unique(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function normalizeForPhrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function phraseMatches(text: string, phrase: string): boolean {
  return normalizeForPhrase(text).includes(normalizeForPhrase(phrase));
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
    out[match[1] as "name" | "description"] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return out;
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

export function loadSkillCatalog(): SkillCatalogEntry[] {
  const byName = new Map<string, SkillCatalogEntry>();

  for (const root of skillRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const skillDir = join(root, entry);
      const skillFile = join(skillDir, "SKILL.md");
      try {
        if (!statSync(skillDir).isDirectory() || !existsSync(skillFile)) continue;
        const raw = readFileSync(skillFile, "utf-8");
        const parsed = parseFrontmatter(raw);
        const name = parsed.name ?? entry;
        if (!/^[a-z0-9-]+$/.test(name) || byName.has(name)) continue;
        const description = parsed.description ?? "";
        const aliases = SKILL_ALIASES[name] ?? [];
        const keywords = unique([
          ...tokenize(name.replace(/-/g, " ")),
          ...tokenize(description),
          ...aliases,
        ]);
        byName.set(name, { name, description, filePath: skillFile, baseDir: skillDir, keywords });
      } catch {
        // Ignore unreadable/broken skills in the router catalog.
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadDirectExecActions(): DirectExecAction[] {
  const actions: DirectExecAction[] = [];
  for (const root of skillRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const skillDir = join(root, entry);
      const metadataPath = join(skillDir, "direct-exec.json");
      try {
        if (!statSync(skillDir).isDirectory() || !existsSync(metadataPath)) continue;
        const raw = JSON.parse(readFileSync(metadataPath, "utf-8"));
        const list = Array.isArray(raw.actions) ? raw.actions : [];
        for (const action of list) {
          if (!isDirectExecSafe(action)) continue;
          if (typeof action.id !== "string" || typeof action.script !== "string") continue;
          const scriptPath = safeScriptPath(skillDir, action.script);
          if (!scriptPath) continue;
          actions.push({
            id: action.id,
            skill: entry,
            description: typeof action.description === "string" ? action.description : "",
            script: normalize(action.script),
            scriptPath,
            baseDir: skillDir,
            directExec: true,
            safety: action.safety,
            requiresConfirmation: false,
            defaultArgs: Array.isArray(action.defaultArgs) ? action.defaultArgs.map(String) : [],
            keywords: Array.isArray(action.keywords) ? action.keywords.map(String) : [],
            exactPhrases: Array.isArray(action.exactPhrases) ? action.exactPhrases.map(String) : [],
          });
        }
      } catch {
        // Ignore malformed direct-exec metadata; skill path remains available.
      }
    }
  }
  return actions.sort((a, b) => a.id.localeCompare(b.id));
}

function broadGate(text: string, catalog: SkillCatalogEntry[], actions: DirectExecAction[]): BroadGateDecision {
  const terms = unique([
    ...catalog.flatMap((skill) => skill.keywords),
    ...actions.flatMap((action) => [...action.keywords, ...action.exactPhrases]),
  ]);
  const tokens = new Set(tokenize(text));
  const matches = terms.filter((term) => term.includes(" ") ? phraseMatches(text, term) : tokens.has(term.toLowerCase()));

  if (matches.length > 0) {
    return {
      bucket: "deterministic",
      deterministicKind: "skill_or_action",
      confidence: Math.min(0.99, 0.35 + matches.length * 0.12),
      reason: "matched known deterministic affordance term(s); run selector and execution gate",
      matchedTerms: unique(matches),
    };
  }

  return {
    bucket: "normal_msg",
    deterministicKind: null,
    confidence: 0.05,
    reason: "no broad deterministic affordance matched",
    matchedTerms: [],
  };
}

/** Current skill selector: rules/catalog scoring. Later replacement point for embeddings. */
function selectSkillCandidate(text: string, catalog: SkillCatalogEntry[]): SkillScore[] {
  return catalog
    .map((skill) => scoreSkill(text, skill))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function scoreDirectExecAction(text: string, action: DirectExecAction, selectedSkill: string | null): DirectExecCandidate {
  const tokens = new Set(tokenize(text));
  const matchedTerms: string[] = [];
  let score = 0;

  if (selectedSkill && selectedSkill === action.skill) score += 0.18;

  for (const phrase of action.exactPhrases) {
    if (!phraseMatches(text, phrase)) continue;
    matchedTerms.push(phrase);
    score += 0.65;
  }

  for (const keyword of action.keywords) {
    const matched = keyword.includes(" ") ? phraseMatches(text, keyword) : tokens.has(keyword.toLowerCase());
    if (!matched) continue;
    matchedTerms.push(keyword);
    score += keyword.includes(" ") ? 0.25 : 0.08;
  }

  return {
    actionId: action.id,
    skill: action.skill,
    script: action.script,
    args: action.defaultArgs,
    score: Math.min(0.99, Number(score.toFixed(2))),
    matchedTerms: unique(matchedTerms),
    safety: action.safety,
  };
}

function selectDirectExecCandidate(text: string, actions: DirectExecAction[], selectedSkill: string | null): DirectExecCandidate | null {
  const best = actions
    .map((action) => scoreDirectExecAction(text, action, selectedSkill))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < DIRECT_EXEC_THRESHOLD) return null;
  return best;
}

function isVisualInspectRequest(text: string): boolean {
  return /\b(what'?s|what is|describe|inspect|read|look at|see|visible|on screen|in the screenshot|in the photo|in the picture|contents?)\b/i.test(text);
}

function scoreSkill(text: string, skill: SkillCatalogEntry): SkillScore {
  const textTokens = new Set(tokenize(text));
  const matchedTerms: string[] = [];
  let score = 0;

  if (phraseMatches(text, skill.name.replace(/-/g, " "))) {
    score += 0.25;
    matchedTerms.push(skill.name);
  }

  for (const keyword of skill.keywords) {
    const isPhrase = keyword.includes(" ");
    const matched = isPhrase ? phraseMatches(text, keyword) : textTokens.has(keyword.toLowerCase());
    if (!matched) continue;
    matchedTerms.push(keyword);
    score += isPhrase ? 0.38 : 0.14;
  }

  // Weather/location cue boost keeps the first target behavior strong while the
  // deterministic-affordance catalog remains small and rule-based.
  if (skill.name === "weather" && /\b(in|near|for|at|around|tonight|tomorrow|today|weekend|jacket|umbrella|outside)\b/i.test(text) && matchedTerms.length > 0) {
    score += 0.25;
  }

  return {
    skill: skill.name,
    score: Math.min(0.99, Number(score.toFixed(2))),
    matchedTerms: unique(matchedTerms),
  };
}

function findVisualInspectDirectExec(
  text: string,
  actions: DirectExecAction[],
  selectedSkill: string | null,
): DirectExecCandidate | null {
  if (!selectedSkill || !isVisualInspectRequest(text)) return null;
  const actionId =
    selectedSkill === "take-screenshot"
      ? "take-screenshot.capture"
      : selectedSkill === "take-photo"
        ? "take-photo.capture"
        : null;
  if (!actionId) return null;

  const action = actions.find((item) => item.id === actionId && item.skill === selectedSkill);
  if (!action) return null;

  return {
    actionId: action.id,
    skill: action.skill,
    script: action.script,
    args: action.defaultArgs,
    score: Math.max(DIRECT_EXEC_THRESHOLD, 0.9),
    matchedTerms: unique(["visual-inspect", ...action.keywords.filter((keyword) => phraseMatches(text, keyword))]),
    safety: action.safety,
  };
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
export function routeVoiceTranscript(text: string): VoiceRouteDecision {
  const cleaned = text.trim();
  const catalog = loadSkillCatalog();
  const directActions = loadDirectExecActions();
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
      topCandidates: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Deterministic broad bucket: first select the affordance/skill. This selector
  // is the planned replacement point for embeddings, followed later by optional CE reranking.
  const candidates = selectSkillCandidate(cleaned, catalog);
  const best = candidates[0];
  const second = candidates[1];
  const margin = best && second ? best.score - second.score : best ? best.score : 0;
  const skillConfident = Boolean(best && best.score >= PI_SKILL_THRESHOLD && (!second || margin >= PI_SKILL_MARGIN));
  const selectedSkill = skillConfident && best ? best.skill : null;
  const visualInspectSkill =
    best && isVisualInspectRequest(cleaned) && (best.skill === "take-screenshot" || best.skill === "take-photo") ? best.skill : null;

  // Third node: if metadata says a script is safe and the request is exact enough,
  // route as direct_exec. Otherwise deterministic requests use the contextual skill path.
  const directExecSkill = selectedSkill ?? visualInspectSkill;
  const visualInspectDirectExec = findVisualInspectDirectExec(cleaned, directActions, directExecSkill);
  const directExec = visualInspectDirectExec ?? selectDirectExecCandidate(cleaned, directActions, selectedSkill);
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
      topCandidates: candidates,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    bucket: skillConfident ? "deterministic" : "normal_msg",
    executionMode: skillConfident ? "pi_skill" : null,
    broadGate: gate,
    candidateSkill: selectedSkill,
    directExec: null,
    confidence: best ? best.score : gate.confidence,
    reason: skillConfident
      ? `broad gate chose deterministic; selector matched skill above threshold (${PI_SKILL_THRESHOLD}) and margin (${PI_SKILL_MARGIN}); execution gate chose contextual pi_skill path`
      : best
        ? "broad gate chose deterministic, but selector confidence/margin was too low; default normal message to Pi"
        : "broad gate chose deterministic, but selector found no candidate; default normal message to Pi",
    text: cleaned,
    matchedTerms: best?.matchedTerms ?? gate.matchedTerms,
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

export function resolveSkill(name: string): ResolvedSkill | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;

  for (const root of skillRoots()) {
    const skillDir = join(root, name);
    const filePath = join(skillDir, "SKILL.md");
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    return {
      name,
      filePath,
      baseDir: dirname(filePath),
      body: parsed.body.trim(),
    };
  }

  return null;
}

export function buildSkillUserMessage(skill: ResolvedSkill, userText: string): string {
  const safeName = basename(skill.baseDir);
  const skillBlock = `<skill name="${safeName}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${skill.body}\n</skill>`;
  return `${skillBlock}\n\n${userText}`;
}

export async function runDirectExecAction(candidate: DirectExecCandidate, timeoutMs = 30000): Promise<DirectExecResult> {
  const action = loadDirectExecActions().find((item) => item.id === candidate.actionId && item.skill === candidate.skill);
  if (!action) throw new Error(`Direct-exec action not found or not eligible: ${candidate.actionId}`);
  const { stdout, stderr } = await execFileAsync(action.scriptPath, action.defaultArgs, {
    cwd: action.baseDir,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr };
}

export function findDirectExecImagePath(decision: VoiceRouteDecision, result: DirectExecResult): string | null {
  const key = decision.directExec?.skill === "take-photo" ? "PHOTO" : "SCREENSHOT";
  const match = result.stdout.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim() || null;
}

export function shouldAttachDirectExecImage(decision: VoiceRouteDecision): boolean {
  if (!decision.directExec) return false;
  if (decision.directExec.skill !== "take-screenshot" && decision.directExec.skill !== "take-photo") return false;
  return decision.directExec.matchedTerms.includes("visual-inspect") || isVisualInspectRequest(decision.text);
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
