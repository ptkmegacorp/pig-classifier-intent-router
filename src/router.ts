import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

export type VoiceRouteBucket = "pi_skill" | "direct_exec" | "normal_msg";

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

export interface BroadGateDecision {
  bucket: VoiceRouteBucket;
  confidence: number;
  reason: string;
  matchedTerms: string[];
}

export interface VoiceRouteDecision {
  /** Final runtime bucket after broad gate + selector/threshold. */
  bucket: VoiceRouteBucket;
  /** First-stage rules gate. Later this can be a tiny classifier. */
  broadGate: BroadGateDecision;
  candidateSkill: string | null;
  confidence: number;
  reason: string;
  text: string;
  matchedTerms: string[];
  topCandidates: SkillScore[];
  timestamp: string;
}

export interface ResolvedSkill {
  name: string;
  filePath: string;
  baseDir: string;
  body: string;
}

const PI_SKILL_THRESHOLD = Number(process.env.PI_VOICE_SKILL_THRESHOLD ?? "0.5");
const PI_SKILL_MARGIN = Number(process.env.PI_VOICE_SKILL_MARGIN ?? "0.12");

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "use", "user", "when", "with",
  "asks", "ask", "agent", "ai", "pig", "pi", "current", "latest", "what", "this", "that", "there", "here",
]);

const DIRECT_EXEC_TERMS = [
  "focus left", "focus right", "focus up", "focus down",
  "move window", "move left", "move right", "move up", "move down",
  "resize", "split", "workspace", "switch workspace", "pane", "container",
];

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

function broadGate(text: string, catalog: SkillCatalogEntry[]): BroadGateDecision {
  const piSkillTerms = unique(catalog.flatMap((skill) => skill.keywords));
  const piSkillMatches = piSkillTerms.filter((term) => term.includes(" ") ? phraseMatches(text, term) : new Set(tokenize(text)).has(term));
  const directMatches = DIRECT_EXEC_TERMS.filter((term) => phraseMatches(text, term));

  if (directMatches.length > 0 && piSkillMatches.length === 0) {
    return {
      bucket: "direct_exec",
      confidence: Math.min(0.99, 0.45 + directMatches.length * 0.15),
      reason: "matched direct-exec control phrase; direct execution is reserved for future use",
      matchedTerms: unique(directMatches),
    };
  }

  if (piSkillMatches.length > 0) {
    return {
      bucket: "pi_skill",
      confidence: Math.min(0.99, 0.35 + piSkillMatches.length * 0.12),
      reason: "matched known skill affordance term(s); run catalog selector",
      matchedTerms: unique(piSkillMatches),
    };
  }

  return {
    bucket: "normal_msg",
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

/**
 * General phase-2 transcript router.
 *
 * Core question: does the transcript confidently match one of our known
 * deterministic affordances? If yes, use that deterministic path. If not, fall
 * back to Gemma/Pi as a normal message.
 *
 * Buckets:
 * - pi_skill: deterministic selection of a Pi/Pig skill context, then pass the transcript to it.
 * - direct_exec: reserved for future deterministic script/action execution; not emitted yet.
 * - normal_msg: safe fallback; send the transcript to Pi normally.
 */
export function routeVoiceTranscript(text: string): VoiceRouteDecision {
  const cleaned = text.trim();
  const catalog = loadSkillCatalog();
  const gate = broadGate(cleaned, catalog);

  if (gate.bucket === "normal_msg") {
    return {
      bucket: "normal_msg",
      broadGate: gate,
      candidateSkill: null,
      confidence: gate.confidence,
      reason: "broad gate chose normal_msg; default normal message to Pi",
      text: cleaned,
      matchedTerms: gate.matchedTerms,
      topCandidates: [],
      timestamp: new Date().toISOString(),
    };
  }

  if (gate.bucket === "direct_exec") {
    return {
      bucket: "direct_exec",
      broadGate: gate,
      candidateSkill: null,
      confidence: gate.confidence,
      reason: "broad gate matched direct_exec; execution is not implemented yet, so input extension will pass through unchanged",
      text: cleaned,
      matchedTerms: gate.matchedTerms,
      topCandidates: [],
      timestamp: new Date().toISOString(),
    };
  }

  // pi_skill broad bucket: run the current catalog selector. This function is
  // the planned replacement point for embeddings, followed later by optional CE reranking.
  const candidates = selectSkillCandidate(cleaned, catalog);
  const best = candidates[0];
  const second = candidates[1];
  const margin = best && second ? best.score - second.score : best ? best.score : 0;
  const confident = Boolean(best && best.score >= PI_SKILL_THRESHOLD && (!second || margin >= PI_SKILL_MARGIN));

  return {
    bucket: confident ? "pi_skill" : "normal_msg",
    broadGate: gate,
    candidateSkill: confident && best ? best.skill : null,
    confidence: best ? best.score : gate.confidence,
    reason: confident
      ? `broad gate chose pi_skill; selector matched skill above threshold (${PI_SKILL_THRESHOLD}) and margin (${PI_SKILL_MARGIN})`
      : best
        ? "broad gate chose pi_skill, but selector confidence/margin was too low; default normal message to Pi"
        : "broad gate chose pi_skill, but selector found no candidate; default normal message to Pi",
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
